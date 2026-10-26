const mongoose = require("mongoose")
const {Reservation} = require("../models/reservationModel")
const {Resource} = require("../models/resourceModel")
const {User} = require("../models/userModel")
const {ExamWindow} = require("../models/examWindowModel")
const {AllocationRun} = require("../models/allocationRunModel")
const {allocateReservation} = require("../utils/allocation")
const {hasSeatMap} = require("../utils/seats")
const {createOffer, expireOfferIfNeeded} = require("../utils/alternatives")
const {getQueuePosition, reconsiderWaitlist} = require("../utils/waitlist")
const {getToday, hasStarted, isSlotAligned} = require("../utils/timeCheck")
const {calculatePriorityScore} = require("../utils/priority")

// the purposes a request can have (the tier of each purpose is in utils/priority.js)
const PURPOSES = ["job_interview", "end_semester_exam", "mid_semester_exam", "quarterly_test", "project_work", "general_study"]

// offerData => the alternative offer of a booking (the offered resource has its label), or null if there is none
const offerData = (offer) => {
    if (!offer || !offer.status) {
        return null
    }
    const resource = offer.resource
    return {
        status: offer.status,
        expiresAt: offer.expiresAt,
        resource: resource && resource.label ? {id: resource._id, label: resource.label, zone: resource.zone} : null
    }
}

// reservationData => the booking object we send (the old pages use "id").
// myId is the logged in user. With it we also say if he made the booking or is only a group member.
// queuePosition is only given for a waitlisted booking (1 = first in the queue)
const reservationData = (reservation, myId, queuePosition) => {
    const resource = reservation.resource
    const user = reservation.user
    const data = {
        id: reservation._id,
        resource: resource && resource.label
            ? {id: resource._id, label: resource.label, type: resource.type, zone: resource.zone, capacity: resource.capacity}
            : resource,
        date: reservation.date,
        startTime: reservation.startTime,
        endTime: reservation.endTime,
        status: reservation.status,
        purpose: reservation.purpose,
        eventDate: reservation.eventDate,
        groupSize: reservation.groupSize || 1,
        reason: reservation.reason,
        priorityScore: reservation.priorityScore,
        checkedIn: reservation.checkedIn,
        createdAt: reservation.createdAt,
        offer: offerData(reservation.offer),
        originalResource: reservation.originalResource && reservation.originalResource.label
            ? {id: reservation.originalResource._id, label: reservation.originalResource.label}
            : null,
        waitlistedAt: reservation.waitlistedAt,
        queuePosition: queuePosition || null,
        preferredSeats: reservation.preferredSeats || [],
        seats: reservation.status === "confirmed" ? reservation.seats || [] : [], // only a confirmed booking has seats
        members: (reservation.members || []).filter(member => member && member.name).map(member => {
            return {name: member.name, email: member.email}
        })
    }
    if (myId) {
        const ownerId = user && user._id ? user._id : user
        data.isRequester = String(ownerId) === String(myId)
        data.requester = user && user.name ? {name: user.name} : null
    }
    return data
}

// checkPreferredSeats => checks the seats a student wishes for (Phase 4). The wish is optional.
// It gives back {seats} with the clean list, or {error} with a text. An empty wish is fine: the library chooses.
const checkPreferredSeats = (wish, resource, groupSize) => {
    if (wish === undefined || wish === null) {
        return {seats: []}
    }
    if (!Array.isArray(wish)) {
        return {error: "preferredSeats must be a list of seat names like [\"A1\", \"A2\"]"}
    }
    if (wish.length === 0) {
        return {seats: []}
    }
    if (!hasSeatMap(resource)) {
        return {error: "This room has no seat map, so you cannot choose seats"}
    }
    const seats = []
    for (const item of wish) {
        const label = String(item).trim().toUpperCase()
        if (seats.includes(label)) {
            return {error: "The seat " + label + " is listed twice"}
        }
        const exists = resource.layout.seats.find(seat => seat.label === label)
        if (!exists) {
            return {error: "The seat " + label + " does not exist in this room"}
        }
        seats.push(label)
    }
    if (seats.length !== groupSize) {
        return {error: "Choose exactly " + groupSize + " seat(s) for this group, or none and let the library choose"}
    }
    return {seats}
}

// createReservation => a student asks for a resource. The server decides everything.
// user, status, priorityScore, groupSize and reason sent in the body are ignored.
// The request waits as "pending" until the admin runs the allocation for that date.
// If a run for that date already exists, the request is allocated at once.
const createReservation = async (req, res) => {
    try {
        const {resourceId, date, startTime, endTime, eventDate} = req.body
        const purpose = req.body.purpose || "general_study"

        // 1. the basic checks
        if (!resourceId || !date || !startTime || !endTime) {
            return res.status(400).send({message: "resourceId, date, startTime and endTime are required"})
        }
        if (!mongoose.isValidObjectId(resourceId)) {
            return res.status(400).send({message: "Invalid resource id"})
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
            return res.status(400).send({message: "Date must be YYYY-MM-DD and times must be HH:MM"})
        }
        if (!isSlotAligned(startTime) || !isSlotAligned(endTime)) {
            return res.status(400).send({message: "Times must be on the hour or half hour, like 10:00 or 10:30"})
        }
        if (startTime >= endTime) {
            return res.status(400).send({message: "End time must be after start time"})
        }
        if (date < getToday()) {
            return res.status(400).send({message: "Cannot book in the past"})
        }
        if (!PURPOSES.includes(purpose)) {
            return res.status(400).send({message: "Purpose must be one of: " + PURPOSES.join(", ")})
        }

        // 2. the rules of the purpose. Exams need an exam window of the same kind on the event date
        if (purpose !== "general_study") {
            if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
                return res.status(400).send({message: "eventDate (the day of the interview or exam, YYYY-MM-DD) is required for this purpose"})
            }
            if (eventDate < date) {
                return res.status(400).send({message: "The event date cannot be before the booking date"})
            }
            if (purpose === "end_semester_exam" || purpose === "mid_semester_exam") {
                const examWindow = await ExamWindow.findOne({
                    kind: purpose,
                    startDate: {$lte: eventDate},
                    endDate: {$gte: eventDate}
                })
                if (!examWindow) {
                    return res.status(400).send({message: "There is no " + purpose.replace(/_/g, " ") + " window on " + eventDate})
                }
            }
        }

        // the resource must exist and be active
        const resource = await Resource.findById(resourceId)
        if (!resource) {
            return res.status(404).send({message: "Resource not found"})
        }
        if (!resource.active) {
            return res.status(400).send({message: "This resource is not available for booking"})
        }

        // the user is read from the database, so a suspension is never missed (the token is not enough)
        const user = await User.findById(req.user.id)
        if (!user) {
            return res.status(404).send({message: "User not found"})
        }
        if (user.suspended && (!user.suspendedUntil || user.suspendedUntil > new Date())) {
            const until = user.suspendedUntil ? " until " + user.suspendedUntil.toISOString().split("T")[0] : " indefinitely"
            return res.status(403).send({message: "Your account is suspended" + until + ". You cannot make new bookings"})
        }

        // 4. the other members of the group (their emails). The requester is not listed
        const memberEmails = req.body.memberEmails || []
        if (!Array.isArray(memberEmails)) {
            return res.status(400).send({message: "memberEmails must be a list of emails"})
        }
        const emails = memberEmails.map(email => String(email).trim().toLowerCase()).filter(email => email !== "")
        if (new Set(emails).size !== emails.length) {
            return res.status(400).send({message: "The same member email is listed twice"})
        }
        if (emails.includes(user.email)) {
            return res.status(400).send({message: "You are the person who books, do not list your own email as a member"})
        }
        const members = []
        for (const email of emails) {
            const member = await User.findOne({email})
            if (!member) {
                return res.status(400).send({message: "No user has the email " + email})
            }
            members.push(member)
        }
        // the group size is calculated here, never taken from the client
        const groupSize = 1 + members.length
        if (groupSize > resource.capacity) {
            return res.status(400).send({message: "Group is bigger than this resource's capacity"})
        }

        // Phase 4: the seats the student wishes for (only a wish, nothing is held)
        const wish = checkPreferredSeats(req.body.preferredSeats, resource, groupSize)
        if (wish.error) {
            return res.status(400).send({message: wish.error})
        }

        // 5. nobody in the group may have another pending or confirmed booking at that time
        const people = [{id: user._id, email: user.email, isRequester: true}]
        for (const member of members) {
            people.push({id: member._id, email: member.email, isRequester: false})
        }
        for (const person of people) {
            const busy = await Reservation.findOne({
                status: {$in: ["pending", "confirmed"]},
                date,
                startTime: {$lt: endTime},
                endTime: {$gt: startTime},
                $or: [{user: person.id}, {members: person.id}]
            })
            if (busy) {
                const message = person.isRequester
                    ? "You already have a booking that overlaps this time"
                    : person.email + " already has a booking at that time"
                return res.status(409).send({message})
            }
        }

        // 6. save the request as pending. The score is saved only to be shown
        const priorityScore = await calculatePriorityScore(user, date)
        const reservation = await Reservation.create({
            user: user._id,
            resource: resource._id,
            date,
            startTime,
            endTime,
            purpose,
            eventDate: purpose === "general_study" ? undefined : eventDate,
            members: members.map(member => member._id),
            groupSize,
            preferredSeats: wish.seats,
            status: "pending",
            reason: "Waiting for the allocation run for " + date,
            priorityScore
        })

        // 7. if the admin already ran the allocation for this date, allocate this request at once.
        // It only uses the seats that are left, a confirmed booking is never replaced
        const run = await AllocationRun.findOne({date})
        if (run) {
            await allocateReservation(reservation, resource)
        }

        reservation.resource = resource

        // Phase 3: a request that could not be seated gets ONE alternative offer, if another resource
        // of the same type is free. The student answers it in My Bookings
        if (reservation.status === "unallocated") {
            await createOffer(reservation)
        }
        await reservation.populate([
            {path: "members", select: "name email"},
            {path: "originalResource", select: "label"},
            {path: "offer.resource", select: "label zone"}
        ])
        let message = "Request received. Seats are assigned when the admin runs the allocation for " + date
        if (reservation.status === "confirmed") {
            message = "Booked. Your seats are confirmed"
        } else if (reservation.status === "unallocated") {
            message = reservation.reason
        }
        res.status(201).send({message, data: reservationData(reservation, req.user.id)})
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

// getMyReservations => the bookings I made and the group bookings I am a member of, newest first
const getMyReservations = async (req, res) => {
    try {
        const reservations = await Reservation.find({$or: [{user: req.user.id}, {members: req.user.id}]})
            .populate("resource")
            .populate("user", "name")
            .populate("members", "name email")
            .populate("originalResource", "label")
            .populate("offer.resource", "label zone")
            .sort({date: -1, startTime: -1})

        // an open offer that is too old is closed when it is read (there is no background job)
        for (const reservation of reservations) {
            if (reservation.offer && reservation.offer.status === "offered") {
                await expireOfferIfNeeded(reservation)
            }
        }
        const data = []
        for (const reservation of reservations) {
            const queuePosition = await getQueuePosition(reservation)
            data.push(reservationData(reservation, req.user.id, queuePosition))
        }
        res.status(200).send({message: "Reservations fetched successfully", data})
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

// cancelReservation => the person who made the booking (or an admin) cancels a pending, unallocated,
// waitlisted or confirmed booking that has not started. A group member cannot cancel.
// When a confirmed booking is cancelled its seats are free, so the waitlist of that resource is reconsidered
const cancelReservation = async (req, res) => {
    try {
        const id = req.params.id
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).send({message: "Invalid reservation id"})
        }
        const reservation = await Reservation.findById(id)
        if (!reservation) {
            return res.status(404).send({message: "Reservation not found"})
        }
        if (String(reservation.user) !== req.user.id && req.user.role !== "admin") {
            const isMember = reservation.members.some(member => String(member) === req.user.id)
            const message = isMember
                ? "Only the person who made this booking can cancel it"
                : "You can cancel only your own bookings"
            return res.status(403).send({message})
        }
        if (!["pending", "unallocated", "waitlisted", "confirmed"].includes(reservation.status)) {
            return res.status(400).send({message: "This booking cannot be cancelled"})
        }
        if (hasStarted(reservation.date, reservation.startTime)) {
            return res.status(400).send({message: "A booking that has started cannot be cancelled"})
        }

        const wasConfirmed = reservation.status === "confirmed"
        reservation.status = "cancelled"
        reservation.reason = "Cancelled"
        await reservation.save()
        if (wasConfirmed) {
            await reconsiderWaitlist(reservation.resource, reservation.date, reservation.startTime, reservation.endTime)
        }
        res.status(200).send({message: "Booking cancelled successfully", data: reservationData(reservation, req.user.id)})
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

module.exports = {createReservation, getMyReservations, cancelReservation}
