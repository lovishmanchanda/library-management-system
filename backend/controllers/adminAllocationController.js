const {Reservation} = require("../models/reservationModel")
const {Resource} = require("../models/resourceModel")
const {AllocationRun} = require("../models/allocationRunModel")
const {allocateReservation} = require("../utils/allocation")
const {createOffer, expireOfferIfNeeded} = require("../utils/alternatives")
const {getPriority, compareReservations} = require("../utils/priority")

// decisionRow => one line of the answer: who got what and why.
// offerInfo is {status, resource} when the request has an alternative offer, otherwise null
const decisionRow = (item, offerInfo) => {
    const reservation = item.reservation
    return {
        id: reservation._id,
        user: reservation.user.name,
        resource: reservation.resource.label,
        date: reservation.date,
        startTime: reservation.startTime,
        endTime: reservation.endTime,
        purpose: reservation.purpose,
        groupSize: reservation.groupSize || 1,
        tier: item.tier,
        score: item.score,
        status: reservation.status,
        reason: reservation.reason,
        offer: offerInfo,
        seats: reservation.status === "confirmed" ? reservation.seats || [] : []
    }
}

// runAllocation => the admin gives a date. We rank all pending and unallocated requests of that
// date and allocate them one by one. Confirmed, cancelled, no_show and waitlisted bookings are never touched.
// Phase 3: when all seats are decided, every request that stayed unallocated gets ONE alternative offer
const runAllocation = async (req, res) => {
    try {
        const date = req.body.date
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).send({message: "date is required and must be like 2026-10-25"})
        }

        // 1. load the requests of that date
        const reservations = await Reservation.find({date, status: {$in: ["pending", "unallocated"]}})
            .populate("user")
            .populate("resource")

        // 2. calculate the tier and score of every request
        const ranked = []
        for (const reservation of reservations) {
            if (!reservation.user || !reservation.resource) {
                continue // the user or the resource was deleted, nothing to allocate
            }
            const priority = await getPriority(reservation.user, reservation)
            reservation.priorityScore = priority.score
            ranked.push({reservation, tier: priority.tier, score: priority.score, createdAt: reservation.createdAt, _id: reservation._id})
        }

        // 3. sort: tier first, then score, then older request, then _id
        ranked.sort(compareReservations)

        // 4. allocate one by one in that order
        let confirmed = 0
        let unallocated = 0
        for (const item of ranked) {
            const reservation = item.reservation
            const oldReason = reservation.reason
            if (!reservation.resource.active) {
                reservation.status = "unallocated"
                reservation.reason = "This resource is not available for booking"
                await reservation.save()
            } else {
                await allocateReservation(reservation, reservation.resource)
            }
            if (reservation.status === "unallocated" && reservation.offer && reservation.offer.status) {
                // a request that already has an offer (a second run): keep its reason with the offer text
                reservation.reason = oldReason
                await reservation.save()
            }
            if (reservation.status === "confirmed") {
                confirmed++
            } else {
                unallocated++
            }
        }

        // 5. now that all seats are decided, every unallocated request gets ONE alternative (if one is free).
        // A request that is confirmed now closes its old offer. A request never gets a second offer
        let offersCreated = 0
        for (const item of ranked) {
            const reservation = item.reservation
            if (reservation.status === "unallocated") {
                const made = await createOffer(reservation)
                if (made) {
                    offersCreated++
                }
            } else if (reservation.offer && reservation.offer.status === "offered") {
                await expireOfferIfNeeded(reservation)
            }
        }

        // 6. the lines of the answer (with the offer of each request, if it has one)
        const decisions = []
        for (const item of ranked) {
            const reservation = item.reservation
            let offerInfo = null
            if (reservation.offer && reservation.offer.status) {
                const alternative = await Resource.findById(reservation.offer.resource)
                offerInfo = {status: reservation.offer.status, resource: alternative ? alternative.label : null}
            }
            decisions.push(decisionRow(item, offerInfo))
        }

        // 7. save a record of this run
        const run = await AllocationRun.create({
            date,
            ranBy: req.user.id,
            considered: ranked.length,
            confirmed,
            unallocated,
            offers: offersCreated
        })
        res.status(200).send({
            message: "Allocation finished for " + date,
            data: {
                run: {id: run._id, date: run.date, ranAt: run.ranAt, considered: run.considered, confirmed: run.confirmed, unallocated: run.unallocated, offers: run.offers},
                offersCreated,
                decisions
            }
        })
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

// getAllocationRuns => the history of all runs, newest first
const getAllocationRuns = async (req, res) => {
    try {
        const runs = await AllocationRun.find().sort({ranAt: -1}).populate("ranBy", "name")
        const data = runs.map(run => {
            return {
                id: run._id,
                date: run.date,
                ranBy: run.ranBy ? run.ranBy.name : "Unknown",
                ranAt: run.ranAt,
                considered: run.considered,
                confirmed: run.confirmed,
                unallocated: run.unallocated,
                offers: run.offers || 0
            }
        })
        res.status(200).send({message: "Allocation runs fetched successfully", data})
    } catch (error) {
        res.status(500).send({message: error.message})
    }
}

module.exports = {runAllocation, getAllocationRuns}
