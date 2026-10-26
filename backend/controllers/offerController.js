const mongoose = require("mongoose")
const {Reservation} = require("../models/reservationModel")
const {Resource} = require("../models/resourceModel")
const {User} = require("../models/userModel")
const {getSeatsUsed, allocateReservation, findBusyPerson} = require("../utils/allocation")
const {cleanReason, addToReason, expireOfferIfNeeded} = require("../utils/alternatives")
const {getQueuePosition} = require("../utils/waitlist")
const {hasStarted} = require("../utils/timeCheck")

// Phase 3: the student answers the alternative offer of an unallocated booking.
// An offer does not hold any seats, so everything is checked again when the student answers.

// reservationAnswer => the booking we send back after an answer (resource, first choice and offer have their labels)
// queuePosition is only given for a waitlisted booking
const reservationAnswer = async (reservation, queuePosition) => {
    await reservation.populate([
        {path: "resource", select: "label type zone capacity"},
        {path: "originalResource", select: "label"},
        {path: "offer.resource", select: "label zone"}
    ])
    const resource = reservation.resource
    const first = reservation.originalResource
    const offerResource = reservation.offer && reservation.offer.resource
    return {
        id: reservation._id,
        status: reservation.status,
        reason: reservation.reason,
        date: reservation.date,
        startTime: reservation.startTime,
        endTime: reservation.endTime,
        groupSize: reservation.groupSize || 1,
        resource: resource && resource.label
            ? {id: resource._id, label: resource.label, type: resource.type, zone: resource.zone, capacity: resource.capacity}
            : null,
        originalResource: first && first.label ? {id: first._id, label: first.label} : null,
        offer: reservation.offer && reservation.offer.status
            ? {
                status: reservation.offer.status,
                expiresAt: reservation.offer.expiresAt,
                resource: offerResource && offerResource.label ? {id: offerResource._id, label: offerResource.label, zone: offerResource.zone} : null
            }
            : null,
        waitlistedAt: reservation.waitlistedAt,
        queuePosition: queuePosition || null,
        preferredSeats: reservation.preferredSeats || [],
        seats: reservation.status === "confirmed" ? reservation.seats || [] : []
    }
}

// loadReservation => finds the booking of :id. If something is wrong it sends the error itself and returns null.
// Only the person who made the booking can answer (a group member or another student cannot).
// An old open offer is closed here, because there is no background job
const loadReservation = async (req, res) => {
    const id = req.params.id
    if (!mongoose.isValidObjectId(id)) {
        res.status(400).send({message: "Invalid reservation id"})
        return null
    }
    const reservation = await Reservation.findById(id)
    if (!reservation) {
        res.status(404).send({message: "Reservation not found"})
        return null
    }
    if (String(reservation.user) !== req.user.id) {
        res.status(403).send({message: "Only the person who made this booking can do this"})
        return null
    }
    await expireOfferIfNeeded(reservation)
    return reservation
}

// checkOpenOffer => a text that says why the booking has no open offer, or null when the offer is open
const checkOpenOffer = (reservation) => {
    if (!reservation.offer || !reservation.offer.status) {
        return "This booking has no offer"
    }
    if (reservation.offer.status === "expired") {
        return "This offer has expired"
    }
    if (reservation.offer.status !== "offered") {
        return "This offer was already answered"
    }
    return null
}

// acceptOffer => the requester accepts the alternative. The seats and the people are checked again.
// If it fits, the booking moves to the offered resource and is confirmed.
// If it does not fit any more, the booking stays unallocated on its first resource and the offer expires.
const acceptOffer = async (req, res) => {
    try {
        const reservation = await loadReservation(req, res)
        if (!reservation) {
            return
        }
        if (reservation.status !== "unallocated") {
            return res.status(409).send({message: "Only an unallocated booking can accept an offer"})
        }
        const problem = checkOpenOffer(reservation)
        if (problem) {
            return res.status(409).send({message: problem})
        }
        if (hasStarted(reservation.date, reservation.startTime)) {
            return res.status(409).send({message: "A booking that has started cannot accept an offer"})
        }

        // nobody in the group may have another confirmed booking at that time
        const busyId = await findBusyPerson(reservation)
        if (busyId) {
            const busyUser = await User.findById(busyId)
            const who = String(busyId) === String(reservation.user) ? "You already have" : (busyUser ? busyUser.email : "A group member") + " already has"
            return res.status(409).send({message: who + " a confirmed booking at that time"})
        }

        // the seats of the offered resource, counted again
        const alternative = await Resource.findById(reservation.offer.resource)
        const groupSize = reservation.groupSize || 1
        const baseReason = cleanReason(reservation.reason)
        let fits = false
        if (alternative && alternative.active) {
            const used = await getSeatsUsed(alternative._id, reservation.date, reservation.startTime, reservation.endTime, reservation._id)
            fits = used + groupSize <= alternative.capacity
        }
        if (!fits) {
            reservation.offer.status = "expired"
            reservation.reason = addToReason(baseReason, "The alternative filled up before you accepted.")
            await reservation.save()
            return res.status(409).send({message: "The alternative filled up before you accepted. Your request is still unallocated", data: await reservationAnswer(reservation)})
        }

        // confirm on the new resource and remember the first choice.
        // The wished seats belong to the first room, so the wish is dropped. The new room gives its own seats
        const firstChoice = reservation.resource
        const oldWish = reservation.preferredSeats
        reservation.resource = alternative._id
        reservation.preferredSeats = []
        await allocateReservation(reservation, alternative)
        if (reservation.status !== "confirmed") {
            // somebody took the last seats at the same moment, so go back to the first resource and the old wish
            reservation.resource = firstChoice
            reservation.preferredSeats = oldWish
            reservation.status = "unallocated"
            reservation.offer.status = "expired"
            reservation.reason = addToReason(baseReason, "The alternative filled up before you accepted.")
            await reservation.save()
            return res.status(409).send({message: "The alternative filled up before you accepted. Your request is still unallocated", data: await reservationAnswer(reservation)})
        }
        reservation.offer.status = "accepted"
        reservation.originalResource = firstChoice
        reservation.reason = "Allocated on " + alternative.label + " after you accepted the offer"
        await reservation.save()
        res.status(200).send({message: "Offer accepted. Your booking is confirmed on " + alternative.label, data: await reservationAnswer(reservation)})
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

// rejectOffer => the requester says no to the alternative. The booking stays unallocated
const rejectOffer = async (req, res) => {
    try {
        const reservation = await loadReservation(req, res)
        if (!reservation) {
            return
        }
        if (reservation.status !== "unallocated") {
            return res.status(409).send({message: "Only an unallocated booking can reject an offer"})
        }
        const problem = checkOpenOffer(reservation)
        if (problem) {
            return res.status(409).send({message: problem})
        }

        reservation.offer.status = "rejected"
        reservation.reason = addToReason(cleanReason(reservation.reason), "You rejected the alternative. You can join the waitlist, book another time or resource, or cancel the request.")
        await reservation.save()
        res.status(200).send({message: "Offer rejected", data: await reservationAnswer(reservation)})
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

// joinWaitlist => the requester chooses to wait for a free seat. Only an unallocated booking can do this,
// it never happens by itself. An open offer is closed. The place in the queue comes from the usual order
const joinWaitlist = async (req, res) => {
    try {
        const reservation = await loadReservation(req, res)
        if (!reservation) {
            return
        }
        if (reservation.status !== "unallocated") {
            return res.status(409).send({message: "Only an unallocated booking can join the waitlist"})
        }
        if (hasStarted(reservation.date, reservation.startTime)) {
            return res.status(409).send({message: "A booking that has started cannot join the waitlist"})
        }
        const resource = await Resource.findById(reservation.resource)
        if (!resource || !resource.active) {
            return res.status(409).send({message: "This resource is not available, so there is no waitlist for it"})
        }

        if (reservation.offer && reservation.offer.status === "offered") {
            reservation.offer.status = "rejected"
        }
        reservation.status = "waitlisted"
        reservation.waitlistedAt = new Date()
        reservation.reason = "You are on the waitlist. You will be confirmed automatically if seats free up."
        await reservation.save()
        const queuePosition = await getQueuePosition(reservation)
        res.status(200).send({message: "You are on the waitlist", data: await reservationAnswer(reservation, queuePosition)})
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

module.exports = {acceptOffer, rejectOffer, joinWaitlist}
