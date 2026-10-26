const {Reservation} = require("../models/reservationModel")
const {assignSeats, getTakenSeats, hasSeatMap} = require("./seats")

// The one capacity rule of Phase 2. The allocation run and the immediate allocation both use it.
// Only CONFIRMED bookings use seats. pending and unallocated bookings never block anyone.

// getSeatsUsed => seats taken on a resource in a time (a group takes groupSize seats).
// ignoreId is optional: leave that booking out of the count (used when we check a booking itself)
const getSeatsUsed = async (resourceId, date, startTime, endTime, ignoreId) => {
    const filter = {
        resource: resourceId,
        status: "confirmed",
        date,
        startTime: {$lt: endTime},
        endTime: {$gt: startTime}
    }
    if (ignoreId) {
        filter._id = {$ne: ignoreId}
    }
    const bookings = await Reservation.find(filter)
    let used = 0
    for (const booking of bookings) {
        used = used + (booking.groupSize || 1) // old bookings have no groupSize, they count as 1
    }
    return used
}

// allocateReservation => confirm the booking if the WHOLE group fits, otherwise mark it unallocated.
// It never changes any other booking, so a confirmed booking is never taken away.
// Phase 4: in a room with a seat map a confirmed booking also gets its seats (the wished seats if they are free).
const allocateReservation = async (reservation, resource) => {
    const groupSize = reservation.groupSize || 1
    const used = await getSeatsUsed(resource._id, reservation.date, reservation.startTime, reservation.endTime, reservation._id)

    reservation.seats = []
    if (used + groupSize <= resource.capacity) {
        const seats = await assignSeats(reservation, resource)
        if (hasSeatMap(resource) && seats.length < groupSize) {
            // the count said yes, but not enough named seats are free (should not happen)
            reservation.status = "unallocated"
            reservation.reason = "No seats left for your whole group at that time"
        } else {
            reservation.status = "confirmed"
            reservation.reason = "Allocated"
            reservation.seats = seats
        }
    } else {
        reservation.status = "unallocated"
        reservation.reason = "No seats left for your whole group at that time"
    }
    await reservation.save()

    // safety recount: if two requests were confirmed at the same moment and the seats are now
    // over the capacity, this one goes back to unallocated
    if (reservation.status === "confirmed") {
        const total = await getSeatsUsed(resource._id, reservation.date, reservation.startTime, reservation.endTime)
        if (total > resource.capacity) {
            reservation.status = "unallocated"
            reservation.reason = "No seats left for your whole group at that time"
            reservation.seats = []
            await reservation.save()
        }
    }

    // safety recount for the named seats: if another booking was confirmed at the same moment with one of
    // our seats, we choose our seats again (the other booking is not touched)
    if (reservation.status === "confirmed" && reservation.seats.length > 0) {
        const taken = await getTakenSeats(resource._id, reservation.date, reservation.startTime, reservation.endTime, reservation._id)
        let clash = false
        for (const label of reservation.seats) {
            if (taken.includes(label)) {
                clash = true
            }
        }
        if (clash) {
            reservation.seats = await assignSeats(reservation, resource)
            await reservation.save()
        }
    }
    return reservation
}

// findBusyPerson => the id of the first person of the booking (requester or group member) who already
// has ANOTHER confirmed booking at the same time, or null if nobody is busy.
// Used before a booking is confirmed later (accepting an offer, the waitlist) so one person
// is never confirmed in two places at once. The seat rule itself stays in getSeatsUsed.
const findBusyPerson = async (reservation) => {
    const people = [reservation.user, ...(reservation.members || [])]
    for (const person of people) {
        const personId = person._id || person // works for a populated user and for a plain id
        const busy = await Reservation.findOne({
            _id: {$ne: reservation._id},
            status: "confirmed",
            date: reservation.date,
            startTime: {$lt: reservation.endTime},
            endTime: {$gt: reservation.startTime},
            $or: [{user: personId}, {members: personId}]
        })
        if (busy) {
            return personId
        }
    }
    return null
}

module.exports = {getSeatsUsed, allocateReservation, findBusyPerson}
