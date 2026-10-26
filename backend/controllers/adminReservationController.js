const mongoose = require("mongoose")
const {Reservation} = require("../models/reservationModel")
const {Resource} = require("../models/resourceModel")
const {User} = require("../models/userModel")
const {getSeatsUsed, allocateReservation, findBusyPerson} = require("../utils/allocation")
const {expireOfferIfNeeded} = require("../utils/alternatives")
const {getQueuePosition, reconsiderWaitlist} = require("../utils/waitlist")
const {hasStarted} = require("../utils/timeCheck")

// offerRow => the alternative offer of a booking (the offered resource has its label), or null if there is none
const offerRow = (offer) => {
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

// reservationRow => one row for the admin table. user and resource are populated,
// but they can be empty if the user or resource was deleted later.
// queuePosition is only given for a waitlisted booking (1 = first in the queue)
const reservationRow = (reservation, queuePosition) => {
    const user = reservation.user
    const resource = reservation.resource
    return {
        id: reservation._id,
        user: user && user.name ? {id: user._id, name: user.name, email: user.email} : null,
        resource: resource && resource.label ? {id: resource._id, label: resource.label} : null,
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
        preferredSeats: reservation.preferredSeats || [],
        seats: reservation.status === "confirmed" ? reservation.seats || [] : [], // only a confirmed booking has seats
        offer: offerRow(reservation.offer),
        originalResource: reservation.originalResource && reservation.originalResource.label
            ? {id: reservation.originalResource._id, label: reservation.originalResource.label}
            : null,
        queuePosition: queuePosition || null
    }
}

// addDetails => fill the user name and resource label, so the answer looks like the table rows
const addDetails = async (reservation) => {
    await reservation.populate([
        {path: "user", select: "name email"},
        {path: "resource", select: "label"},
        {path: "originalResource", select: "label"},
        {path: "offer.resource", select: "label zone"}
    ])
}

// getAllReservations => every booking with the user and resource, optional ?status= and ?date=
const getAllReservations = async (req, res) => {
    try {
        const filter = {}
        if (req.query.status) {
            filter.status = req.query.status
        }
        if (req.query.date) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
                return res.status(400).send({message: "date must be like 2026-10-25"})
            }
            filter.date = req.query.date
        }
        const reservations = await Reservation.find(filter)
            .populate("user", "name email")
            .populate("resource", "label")
            .populate("originalResource", "label")
            .populate("offer.resource", "label zone")
            .sort({date: 1, startTime: 1})

        // an open offer that is too old is closed when it is read, so the table never shows an expired offer as open
        for (const reservation of reservations) {
            if (reservation.offer && reservation.offer.status === "offered") {
                await expireOfferIfNeeded(reservation)
            }
        }
        const data = []
        for (const reservation of reservations) {
            const queuePosition = await getQueuePosition(reservation)
            data.push(reservationRow(reservation, queuePosition))
        }
        res.status(200).send({message: "Reservations fetched successfully", data})
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

// confirmReservation => force confirm a booking that is waiting, pending, unallocated, waitlisted or bumped.
// It can skip the priority order, but it can never take more seats than the resource has
// and nobody can be confirmed in two places at the same time. An open offer is closed
const confirmReservation = async (req, res) => {
    try {
        const id = req.params.id
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).send({message: "Invalid reservation id"})
        }
        const reservation = await Reservation.findById(id)
        if (!reservation) {
            return res.status(404).send({message: "Reservation not found"})
        }
        if (!["waiting", "pending", "unallocated", "waitlisted", "bumped"].includes(reservation.status)) {
            return res.status(400).send({message: "Only waiting, pending, unallocated, waitlisted or bumped bookings can be force confirmed"})
        }
        const resource = await Resource.findById(reservation.resource)
        if (!resource) {
            return res.status(404).send({message: "The resource of this booking no longer exists"})
        }
        if (!resource.active) {
            return res.status(400).send({message: "This resource is not available for booking"})
        }

        // nobody in the group may have another confirmed booking at that time
        const busyId = await findBusyPerson(reservation)
        if (busyId) {
            const busyUser = await User.findById(busyId)
            const who = busyUser ? busyUser.email : "A group member"
            return res.status(409).send({message: who + " already has a confirmed booking at that time. Force confirm was not applied"})
        }

        // do the seats of the other confirmed bookings leave room for the whole group?
        const used = await getSeatsUsed(resource._id, reservation.date, reservation.startTime, reservation.endTime, reservation._id)
        if (used + (reservation.groupSize || 1) > resource.capacity) {
            return res.status(409).send({message: "There are not enough free seats for this group in that time slot. Force confirm was not applied"})
        }

        // the same capacity rule as the allocation run
        await allocateReservation(reservation, resource)
        if (reservation.status !== "confirmed") {
            return res.status(409).send({message: reservation.reason})
        }
        reservation.reason = "Confirmed by an admin"
        await reservation.save()
        await expireOfferIfNeeded(reservation) // it is confirmed now, so an old open offer is closed
        await addDetails(reservation)
        res.status(200).send({message: "Reservation confirmed successfully", data: reservationRow(reservation)})
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

// adminCancelReservation => admin cancels a pending, waiting, unallocated, waitlisted or confirmed booking.
// When a confirmed booking is cancelled its seats are free, so the waitlist of that resource is reconsidered.
// The answer says how many waitlisted requests were confirmed
const adminCancelReservation = async (req, res) => {
    try {
        const id = req.params.id
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).send({message: "Invalid reservation id"})
        }
        const reservation = await Reservation.findById(id)
        if (!reservation) {
            return res.status(404).send({message: "Reservation not found"})
        }
        if (!["pending", "waiting", "unallocated", "waitlisted", "confirmed"].includes(reservation.status)) {
            return res.status(400).send({message: "This booking cannot be cancelled"})
        }
        const wasConfirmed = reservation.status === "confirmed"
        reservation.status = "cancelled"
        reservation.reason = "Cancelled by an admin"
        await reservation.save()
        let waitlistConfirmed = 0
        if (wasConfirmed) {
            waitlistConfirmed = await reconsiderWaitlist(reservation.resource, reservation.date, reservation.startTime, reservation.endTime)
        }
        await addDetails(reservation)
        res.status(200).send({message: "Reservation cancelled successfully", data: Object.assign(reservationRow(reservation), {waitlistConfirmed})})
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

// markNoShow => only for a confirmed booking that has already started. The booking becomes no_show and
// the user gets one more strike (shown only). Three recent no-shows lower the reliability score,
// but nobody is suspended automatically
const markNoShow = async (req, res) => {
    try {
        const id = req.params.id
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).send({message: "Invalid reservation id"})
        }
        const reservation = await Reservation.findById(id)
        if (!reservation) {
            return res.status(404).send({message: "Reservation not found"})
        }
        if (reservation.status !== "confirmed") {
            return res.status(400).send({message: "Only confirmed bookings can be marked as no-show"})
        }
        if (!hasStarted(reservation.date, reservation.startTime)) {
            return res.status(400).send({message: "A booking can be marked as no-show only after it has started"})
        }
        reservation.status = "no_show"
        await reservation.save()
        await User.findByIdAndUpdate(reservation.user, {$inc: {noShowCount: 1}})
        await addDetails(reservation)
        res.status(200).send({message: "Marked as no-show", data: reservationRow(reservation)})
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

// deleteReservation => admin deletes a booking for good (any status).
// A confirmed booking that has not started frees its seats, so the waitlist is reconsidered
const deleteReservation = async (req, res) => {
    try {
        const id = req.params.id
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).send({message: "Invalid reservation id"})
        }
        const reservation = await Reservation.findByIdAndDelete(id)
        if (!reservation) {
            return res.status(404).send({message: "Reservation not found"})
        }
        let waitlistConfirmed = 0
        if (reservation.status === "confirmed" && !hasStarted(reservation.date, reservation.startTime)) {
            waitlistConfirmed = await reconsiderWaitlist(reservation.resource, reservation.date, reservation.startTime, reservation.endTime)
        }
        await addDetails(reservation)
        res.status(200).send({message: "Reservation deleted successfully", data: Object.assign(reservationRow(reservation), {waitlistConfirmed})})
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

module.exports = {getAllReservations, confirmReservation, adminCancelReservation, markNoShow, deleteReservation}
