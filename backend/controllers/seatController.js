const mongoose = require("mongoose")
const {Resource} = require("../models/resourceModel")
const {hasSeatMap, getTakenSeats} = require("../utils/seats")

// getSeatMap => the seat map of a room for a date and a time, so the booking page can draw it.
// Query: date, startTime, endTime (all required). Each seat says if it is taken (held by a confirmed booking).
// A wish of a student holds nothing, so only confirmed bookings make a seat "taken"
const getSeatMap = async (req, res) => {
    try {
        const id = req.params.id
        const {date, startTime, endTime} = req.query
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).send({message: "Invalid resource id"})
        }
        if (!date || !startTime || !endTime) {
            return res.status(400).send({message: "date, startTime and endTime are required"})
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
            return res.status(400).send({message: "Date must be YYYY-MM-DD and times must be HH:MM"})
        }
        if (startTime >= endTime) {
            return res.status(400).send({message: "End time must be after start time"})
        }

        const resource = await Resource.findById(id)
        if (!resource || (!resource.active && req.user.role !== "admin")) {
            return res.status(404).send({message: "Resource not found"})
        }
        if (!hasSeatMap(resource)) {
            return res.status(400).send({message: "This room has no seat map"})
        }

        const taken = await getTakenSeats(resource._id, date, startTime, endTime)
        const seats = []
        for (const seat of resource.layout.seats) {
            seats.push({label: seat.label, row: seat.row, col: seat.col, taken: taken.includes(seat.label)})
        }
        res.status(200).send({
            message: "Seat map fetched successfully",
            data: {rows: resource.layout.rows, cols: resource.layout.cols, seats}
        })
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

module.exports = {getSeatMap}
