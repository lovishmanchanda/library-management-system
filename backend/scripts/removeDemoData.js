// removeDemoData.js => deletes the presentation data again (the demo users, their requests, messages and exam window)
//
// node scripts/removeDemoData.js             => dry run, only counts what it would delete
// node scripts/removeDemoData.js --confirm   => really deletes
//
// Only rows marked with the demo text in legacyId are deleted (see demoApi.js), plus:
//  - every request of a demo user, and
//  - the allocation runs of the demo days (26 Oct 2026 to 8 Nov 2026).
// The rooms (seedRooms.js) and the real users and bookings are NOT touched.
const mongoose = require("mongoose")
const {connection} = require("../config/db")
const {User} = require("../models/userModel")
const {Reservation} = require("../models/reservationModel")
const {Message} = require("../models/messageModel")
const {ExamWindow} = require("../models/examWindowModel")
const {AllocationRun} = require("../models/allocationRunModel")
const {DEMO_MARK} = require("./demoApi")

const FIRST_DEMO_DAY = "2026-10-26"
const LAST_DEMO_DAY = "2026-11-08"

const run = async () => {
    try {
        const confirm = process.argv.includes("--confirm")
        if (!confirm) {
            console.log("DRY RUN: nothing will be deleted. Add --confirm to really delete.")
        }
        await connection
        console.log("DB connected successfully")

        const demoUsers = await User.find({legacyId: DEMO_MARK})
        const userIds = demoUsers.map(user => user._id)

        const reservationFilter = {$or: [{legacyId: DEMO_MARK}, {user: {$in: userIds}}, {members: {$in: userIds}}]}
        const runFilter = {date: {$gte: FIRST_DEMO_DAY, $lte: LAST_DEMO_DAY}}

        const counts = {
            users: demoUsers.length,
            reservations: await Reservation.countDocuments(reservationFilter),
            messages: await Message.countDocuments({$or: [{legacyId: DEMO_MARK}, {user: {$in: userIds}}]}),
            examWindows: await ExamWindow.countDocuments({legacyId: DEMO_MARK}),
            allocationRuns: await AllocationRun.countDocuments(runFilter)
        }
        console.log((confirm ? "Deleting: " : "Would delete: ") + JSON.stringify(counts))

        if (confirm) {
            await Reservation.deleteMany(reservationFilter)
            await Message.deleteMany({$or: [{legacyId: DEMO_MARK}, {user: {$in: userIds}}]})
            await ExamWindow.deleteMany({legacyId: DEMO_MARK})
            await AllocationRun.deleteMany(runFilter)
            await User.deleteMany({legacyId: DEMO_MARK})
            console.log("Done.")
        } else {
            console.log("Dry run finished. Nothing was deleted.")
        }
    } catch (error) {
        console.log("Removing the demo data failed: " + error.message)
    } finally {
        await mongoose.connection.close()
    }
}

run()
