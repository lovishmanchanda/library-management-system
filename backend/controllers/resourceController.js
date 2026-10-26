const mongoose = require("mongoose")
const {Resource} = require("../models/resourceModel")
const {Reservation} = require("../models/reservationModel")
const {getSeatsUsed} = require("../utils/allocation")
const {getToday} = require("../utils/timeCheck")
const {buildLayout} = require("../utils/layout")
const {hasSeatMap} = require("../utils/seats")

// the only types allowed for new or edited resources
const ALLOWED_TYPES = [
    "study room",
    "discussion_room",
    "carrel",
    "computer station",
    "seminar hall",
    "community study hall",
    "reading pod"
]

// resourceData => the resource object we send (the old pages use "id").
// Phase 4: hasSeatMap and seatCount say if the room has a seat map. The map itself is only in the answer for one room
const resourceData = (resource) => {
    return {
        id: resource._id,
        label: resource.label,
        type: resource.type,
        zone: resource.zone,
        capacity: resource.capacity,
        active: resource.active,
        image: resource.image,
        hasSeatMap: hasSeatMap(resource),
        seatCount: hasSeatMap(resource) ? resource.layout.seats.length : 0
    }
}

// resourceDetails => resourceData plus the seat map (row, col and name of every seat), for one room
const resourceDetails = (resource) => {
    const data = resourceData(resource)
    if (hasSeatMap(resource)) {
        const seats = []
        for (const seat of resource.layout.seats) {
            seats.push({row: seat.row, col: seat.col, label: seat.label})
        }
        data.layout = {rows: resource.layout.rows, cols: resource.layout.cols, seats}
    }
    return data
}

// hasUpcomingBookings => true if the room has bookings that still wait or are confirmed from today on.
// The seat names of these bookings would be wrong if the seat map changed, so the map is locked then
const hasUpcomingBookings = async (resourceId) => {
    const upcoming = await Reservation.countDocuments({
        resource: resourceId,
        status: {$in: ["pending", "confirmed", "unallocated", "waitlisted"]},
        date: {$gte: getToday()}
    })
    return upcoming > 0
}

// readLayout => checks the layout the admin sent {rows, cols, cells} and builds the real one (names of the seats).
// It gives back {layout} or {error}
const readLayout = (body) => {
    if (typeof body !== "object" || Array.isArray(body)) {
        return {error: "layout must be an object with rows, cols and cells"}
    }
    return buildLayout(body.rows, body.cols, body.cells)
}

// getResources => list resources, optional ?type= and ?zone=. Students see only active ones
const getResources = async (req, res) => {
    try {
        const filter = {}
        if (req.query.type) {
            filter.type = req.query.type
        }
        if (req.query.zone) {
            filter.zone = req.query.zone
        }
        if (req.user.role !== "admin") {
            filter.active = true
        }
        const resources = await Resource.find(filter)
        const data = resources.map(resource => resourceData(resource))
        res.status(200).send({message: "Resources fetched successfully", data})
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

// getResourceById => one resource. An inactive resource is hidden from non-admins
const getResourceById = async (req, res) => {
    try {
        const id = req.params.id
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).send({message: "Invalid resource id"})
        }
        const resource = await Resource.findById(id)
        if (!resource || (!resource.active && req.user.role !== "admin")) {
            return res.status(404).send({message: "Resource not found"})
        }
        res.status(200).send({message: "Resource fetched successfully", data: resourceDetails(resource)})
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

// getAvailability => how many seats are taken in the given time.
// Only confirmed bookings use seats, and a group uses as many seats as its group size
const getAvailability = async (req, res) => {
    try {
        const id = req.params.id
        const {date, startTime, endTime} = req.query
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).send({message: "Invalid resource id"})
        }
        if (!date || !startTime || !endTime) {
            return res.status(400).send({message: "date, startTime and endTime are required"})
        }
        if (startTime >= endTime) {
            return res.status(400).send({message: "End time must be after start time"})
        }
        const resource = await Resource.findById(id)
        if (!resource || (!resource.active && req.user.role !== "admin")) {
            return res.status(404).send({message: "Resource not found"})
        }
        const booked = await getSeatsUsed(id, date, startTime, endTime)
        const available = Math.max(0, resource.capacity - booked)
        res.status(200).send({
            message: "Availability fetched successfully",
            data: {capacity: resource.capacity, booked, available}
        })
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

// createResource => admin adds a new resource
const createResource = async (req, res) => {
    try {
        const {label, type, zone, capacity, active, image, layout} = req.body
        const hasLayout = layout !== undefined && layout !== null
        if (!label || !type || (!capacity && !hasLayout)) {
            return res.status(400).send({message: "Label, type and capacity (or a seat map) are required"})
        }
        if (!ALLOWED_TYPES.includes(type)) {
            return res.status(400).send({message: "Type must be one of: " + ALLOWED_TYPES.join(", ")})
        }

        // a room with a seat map: the capacity is the number of seats, a typed capacity is ignored
        let newLayout = undefined
        let newCapacity = Number(capacity)
        if (hasLayout) {
            const result = readLayout(layout)
            if (result.error) {
                return res.status(400).send({message: result.error})
            }
            newLayout = result.layout
            newCapacity = newLayout.seats.length
        } else if (!Number.isInteger(newCapacity) || newCapacity < 1) {
            return res.status(400).send({message: "Capacity must be a whole number, 1 or more"})
        }

        const resource = await Resource.create({
            label,
            type,
            zone,
            capacity: newCapacity,
            layout: newLayout,
            active,
            image
        })
        res.status(201).send({message: "Resource created successfully", data: resourceDetails(resource)})
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

// updateResource => admin edits a resource. Only the fields sent are changed.
// Phase 4: layout changes the seat map (the capacity then becomes the number of seats), layout null removes the map.
// A seat map cannot be changed or removed while the room has upcoming bookings (409)
const updateResource = async (req, res) => {
    try {
        const id = req.params.id
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).send({message: "Invalid resource id"})
        }
        const resource = await Resource.findById(id)
        if (!resource) {
            return res.status(404).send({message: "Resource not found"})
        }

        const {label, type, zone, capacity, active, image, layout} = req.body
        // a migrated resource may have an old type, so only check the type when it changes
        if (type !== undefined && type !== resource.type && !ALLOWED_TYPES.includes(type)) {
            return res.status(400).send({message: "Type must be one of: " + ALLOWED_TYPES.join(", ")})
        }
        if (capacity !== undefined && (!Number.isInteger(Number(capacity)) || Number(capacity) < 1)) {
            return res.status(400).send({message: "Capacity must be a whole number, 1 or more"})
        }

        const updates = {}
        if (label !== undefined) updates.label = label
        if (type !== undefined) updates.type = type
        if (zone !== undefined) updates.zone = zone
        if (active !== undefined) updates.active = active
        if (image !== undefined) updates.image = image
        // the capacity of a room with a seat map is the number of seats, so a typed capacity is ignored there
        if (capacity !== undefined && !hasSeatMap(resource)) updates.capacity = Number(capacity)

        // the seat map
        let removeMap = false
        if (layout !== undefined) {
            if (layout === null) {
                removeMap = hasSeatMap(resource)
            } else {
                const result = readLayout(layout)
                if (result.error) {
                    return res.status(400).send({message: result.error})
                }
                updates.layout = result.layout
                updates.capacity = result.layout.seats.length
            }
            if ((removeMap || updates.layout) && await hasUpcomingBookings(resource._id)) {
                return res.status(409).send({message: "This room has upcoming bookings. Cancel them first before you change or remove its seat map"})
            }
            if (removeMap && capacity !== undefined) {
                updates.capacity = Number(capacity) // without a map the capacity is typed again
            }
        }

        if (Object.keys(updates).length === 0 && !removeMap) {
            return res.status(400).send({message: "Nothing to update"})
        }

        const change = {$set: updates}
        if (removeMap) {
            change.$unset = {layout: ""}
        }
        const data = await Resource.findByIdAndUpdate(id, change, {new: true, runValidators: true})
        res.status(200).send({message: "Resource updated successfully", data: resourceDetails(data)})
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

// deleteResource => admin deletes a resource. Not allowed while it has upcoming pending or confirmed bookings
const deleteResource = async (req, res) => {
    try {
        const id = req.params.id
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).send({message: "Invalid resource id"})
        }
        const upcoming = await Reservation.countDocuments({
            resource: id,
            status: {$in: ["pending", "confirmed"]},
            date: {$gte: getToday()}
        })
        if (upcoming > 0) {
            return res.status(409).send({message: "This resource has upcoming bookings. Cancel them first or mark the resource inactive"})
        }
        const resource = await Resource.findByIdAndDelete(id)
        if (!resource) {
            return res.status(404).send({message: "Resource not found"})
        }
        res.status(200).send({message: "Resource deleted successfully", data: resourceData(resource)})
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

module.exports = {getResources, getResourceById, getAvailability, createResource, updateResource, deleteResource}
