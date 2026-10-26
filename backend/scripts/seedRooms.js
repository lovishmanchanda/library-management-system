// seedRooms.js => gives the library real rooms with seat maps (Phase 4)
//
// node scripts/seedRooms.js             => dry run, only prints what it would do
// node scripts/seedRooms.js --confirm   => really writes to MongoDB
//
// 1. the old test rooms with fewer than 15 seats are archived (set inactive: students do not see them any more,
//    old bookings still show their name)
// 2. an old room with 15 seats or more stays and gets a seat map made from its capacity
// 3. the new rooms are created with their seat maps
// It is safe to run again. A room that already has a seat map is left alone, a room that exists is not created twice.
const mongoose = require("mongoose")
const {connection} = require("../config/db")
const {Resource} = require("../models/resourceModel")
const {Reservation} = require("../models/reservationModel")
const {buildLayout, makeCells} = require("../utils/layout")
const {getToday} = require("../utils/timeCheck")

// rooms with fewer seats than this are archived
const MIN_SEATS = 15

// the new rooms. aisles are the columns (starting at 0) that have no seats
const NEW_ROOMS = [
    {label: "Central Reading Hall", type: "community study hall", zone: "Open Reading Zone", rows: 6, cols: 10, aisles: []},
    {label: "Silent Study Hall", type: "study room", zone: "Silent Zone", rows: 5, cols: 8, aisles: []},
    {label: "Digital Lab", type: "computer station", zone: "Digital Lab", rows: 5, cols: 8, aisles: []},
    {label: "Seminar Hall", type: "seminar hall", zone: "Conference Zone", rows: 5, cols: 11, aisles: [5]},
    {label: "Collaboration Hall", type: "discussion_room", zone: "Collaborative Zone", rows: 5, cols: 6, aisles: []},
    {label: "Interview Room", type: "discussion_room", zone: "Conference Zone", rows: 2, cols: 3, aisles: []}
]

// the grid of an old room that is kept (rows, columns). Other sizes get a square-like grid
const OLD_GRIDS = {20: [4, 5], 16: [4, 4], 15: [3, 5]}

// makeOldLayout => a seat map with exactly "capacity" seats for an old room
const makeOldLayout = (capacity) => {
    let rows = 0
    let cols = 0
    if (OLD_GRIDS[capacity]) {
        rows = OLD_GRIDS[capacity][0]
        cols = OLD_GRIDS[capacity][1]
    } else {
        cols = Math.ceil(Math.sqrt(capacity))
        rows = Math.ceil(capacity / cols)
    }
    const cells = makeCells(rows, cols).slice(0, capacity)
    return buildLayout(rows, cols, cells).layout
}

const hasMap = (room) => {
    return room.layout && room.layout.seats && room.layout.seats.length > 0
}

const run = async () => {
    try {
        const confirm = process.argv.includes("--confirm")
        if (!confirm) {
            console.log("DRY RUN: nothing will be written. Add --confirm to really do it.")
        }
        await connection
        console.log("DB connected successfully")

        let archived = 0
        let mapped = 0
        let created = 0
        const newLabels = NEW_ROOMS.map(room => room.label)

        // 1. and 2. the rooms that are already there
        const rooms = await Resource.find()
        for (const room of rooms) {
            if (hasMap(room) || newLabels.includes(room.label)) {
                continue
            }
            if (room.capacity < MIN_SEATS) {
                if (room.active === false) {
                    continue // archived before
                }
                const upcoming = await Reservation.countDocuments({
                    resource: room._id,
                    status: {$in: ["pending", "confirmed", "unallocated", "waitlisted"]},
                    date: {$gte: getToday()}
                })
                if (upcoming > 0) {
                    console.log("Kept active: " + room.label + " has " + upcoming + " upcoming booking(s)")
                    continue
                }
                console.log((confirm ? "Archived: " : "Would archive: ") + room.label + " (" + room.capacity + " seat(s))")
                if (confirm) {
                    room.active = false
                    await room.save()
                }
                archived++
            } else {
                const layout = makeOldLayout(room.capacity)
                console.log((confirm ? "Seat map made: " : "Would make a seat map: ") + room.label + " (" + layout.rows + " x " + layout.cols + ", " + layout.seats.length + " seats)")
                if (confirm) {
                    room.layout = layout
                    await room.save()
                }
                mapped++
            }
        }

        // 3. the new rooms
        for (const info of NEW_ROOMS) {
            const exists = await Resource.findOne({label: info.label})
            if (exists) {
                console.log("Already there: " + info.label)
                continue
            }
            const result = buildLayout(info.rows, info.cols, makeCells(info.rows, info.cols, info.aisles))
            if (result.error) {
                console.log("Problem with " + info.label + ": " + result.error)
                continue
            }
            console.log((confirm ? "Created: " : "Would create: ") + info.label + " (" + info.type + ", " + info.zone + ", " + result.layout.seats.length + " seats)")
            if (confirm) {
                await Resource.create({
                    label: info.label,
                    type: info.type,
                    zone: info.zone,
                    capacity: result.layout.seats.length,
                    layout: result.layout,
                    active: true
                })
            }
            created++
        }

        console.log("\n" + archived + " room(s) archived, " + mapped + " room(s) got a seat map, " + created + " room(s) created.")
        console.log(confirm ? "Done." : "Dry run finished. Nothing was written.")
    } catch (error) {
        console.log("Seeding rooms failed: " + error.message)
    } finally {
        await mongoose.connection.close()
    }
}

run()
