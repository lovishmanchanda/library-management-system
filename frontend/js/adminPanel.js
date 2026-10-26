// ********************************************************************************************************************************************************
// Every request goes through js/api.js (apiGet, apiPost, apiPatch, apiDelete).
// The server decides what an admin may do. This file only shows the data.
// ********************************************************************************************************************************************************

// Asks the server if the logged in user is an admin. A 403 means no.
// (the role saved in localStorage is only for display, so it is not used here)
async function checkAdminAccess() {
  let response = await fetch(API_BASE + "/admin/users", {
    headers: { Authorization: "Bearer " + localStorage.getItem("token") }
  });

  if (response.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("currentUser");
    window.location.href = "login.html";
  } else if (response.status === 403) {
    alert("Access denied. Only admin users can open the admin panel.");
    window.location.href = "index.html";
  }
}

checkAdminAccess();

// ********************************************************************************************************************************************************
// 1. Admin Reservation OverSight Panel:
// ********************************************************************************************************************************************************

// the purposes written in plain words (the name is different from the one in adminAllocation.js on purpose)
let RESERVATION_PURPOSES = {
  job_interview: "Job interview",
  end_semester_exam: "End semester exam",
  mid_semester_exam: "Mid semester exam",
  quarterly_test: "Quarterly test",
  project_work: "Project work",
  general_study: "General study"
};

// the seats of a reservation as text: the seats it got, or the seats it asked for while it waits
function getSeatsText(reservation) {
  if (reservation.seats && reservation.seats.length > 0) {
    return reservation.seats.join(", ");
  }
  if (reservation.preferredSeats && reservation.preferredSeats.length > 0) {
    return "wish: " + reservation.preferredSeats.join(", ");
  }
  return "—";
}

function getUserName(reservation) {
  return reservation.user ? reservation.user.name : "Unknown";
}

function getResourceLabel(reservation) {
  return reservation.resource ? reservation.resource.label : "Unknown";
}

// the alternative offer of a reservation as short text, for example "offered (Study Room B2) until 14:30"
function getOfferText(reservation) {
  let offer = reservation.offer;
  if (!offer) return "—";
  let text = offer.status;
  if (offer.resource) {
    text = text + " (" + offer.resource.label + ")";
  }
  if (offer.status === "offered" && offer.expiresAt) {
    text = text + " until " + new Date(offer.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return text;
}

// the place in the waitlist queue (only waitlisted reservations have one)
function getQueueText(reservation) {
  return reservation.queuePosition ? "#" + reservation.queuePosition : "—";
}

// the resource, and the first choice when the student accepted an offer for another one
function getResourceText(reservation) {
  let text = getResourceLabel(reservation);
  if (reservation.originalResource) {
    text = text + " (moved from " + reservation.originalResource.label + ")";
  }
  return text;
}

async function renderReservationTable() {
  let filters = currentReservationFilters();

  // the server filters by status and date, the user and resource filters are done here
  let url = "/admin/reservations";
  let query = [];
  if (filters.status !== "all") {
    query.push("status=" + filters.status);
  }
  if (filters.date) {
    query.push("date=" + filters.date);
  }
  if (query.length > 0) {
    url = url + "?" + query.join("&");
  }

  let reservations, users, resources;
  try {
    let [reservationResult, userResult, resourceResult] = await Promise.all([
      apiGet(url),
      apiGet("/admin/users"),
      apiGet("/resources")
    ]);
    reservations = reservationResult.data;
    users = userResult.data;
    resources = resourceResult.data;
  } catch (error) {
    alert(error.message);
    return;
  }

  populateReservationFilterDropdowns(users, resources);

  let tbody = document.getElementById("reservationsTableBody");
  tbody.innerHTML = "";

  reservations.sort((a, b) => {
    return getDateTime(a) - getDateTime(b);
  });
  if (filters.userId !== "all") {
    reservations = reservations.filter(
      (reservation) => reservation.user && String(reservation.user.id) === String(filters.userId),
    );
  }
  if (filters.resourceId !== "all") {
    reservations = reservations.filter(
      (reservation) => reservation.resource && String(reservation.resource.id) === String(filters.resourceId),
    );
  }

  let emptyNote = document.getElementById("reservationsEmptyNote");
  emptyNote.hidden = reservations.length > 0;

  reservations.forEach((reservation) => {
    let row = document.createElement("tr");

    let data = [
      getUserName(reservation),
      getResourceText(reservation),
      reservation.date,
      reservation.startTime + " - " + reservation.endTime,
      RESERVATION_PURPOSES[reservation.purpose] || reservation.purpose || "General study",
      reservation.groupSize || 1,
      getSeatsText(reservation),
      reservation.priorityScore ?? "—",
      reservation.status,
      reservation.reason || "",
      getOfferText(reservation),
      getQueueText(reservation),
      reservation.checkedIn ? "Yes" : "No",
    ];

    data.forEach((value) => {
      let td = document.createElement("td");
      td.innerText = value;
      row.appendChild(td);
    });

    let actionsTd = createActionButtons(reservation);
    row.appendChild(actionsTd);

    tbody.appendChild(row);
  });
}

function populateReservationFilterDropdowns(users, resources) {
  let userSelect = document.getElementById("resFilterUser");
  let resourceSelect = document.getElementById("resFilterResource");

  let selectedUser = userSelect.value;
  let selectedResource = resourceSelect.value;

  userSelect.innerHTML = "";
  let allUsersOption = document.createElement("option");
  allUsersOption.value = "all";
  allUsersOption.innerText = "All users";
  userSelect.appendChild(allUsersOption);

  users.forEach(function (user) {
    let option = document.createElement("option");
    option.value = String(user.id);
    option.innerText = user.name;
    userSelect.appendChild(option);
  });

  resourceSelect.innerHTML = "";
  let allResourcesOption = document.createElement("option");
  allResourcesOption.value = "all";
  allResourcesOption.innerText = "All resources";
  resourceSelect.appendChild(allResourcesOption);

  resources.forEach(function (resource) {
    let option = document.createElement("option");
    option.value = String(resource.id);
    option.innerText = resource.label;
    resourceSelect.appendChild(option);
  });

  userSelect.value = selectedUser;
  resourceSelect.value = selectedResource;
}

function getDateTime(reservation) {
  return new Date(`${reservation.date}T${reservation.startTime}`);
}

function currentReservationFilters() {
  return {
    status: document.getElementById("resFilterStatus").value,
    date: document.getElementById("resFilterDate").value,
    userId: document.getElementById("resFilterUser").value,
    resourceId: document.getElementById("resFilterResource").value,
  };
}

function wireReservationFilters() {
  document
    .getElementById("resFilterStatus")
    .addEventListener("change", renderReservationTable);
  document
    .getElementById("resFilterDate")
    .addEventListener("change", renderReservationTable);
  document
    .getElementById("resFilterUser")
    .addEventListener("change", renderReservationTable);
  document
    .getElementById("resFilterResource")
    .addEventListener("change", renderReservationTable);

  let clearBtn = document.getElementById("resFilterClear");
  clearBtn.addEventListener("click", function () {
    document.getElementById("resFilterStatus").value = "all";
    document.getElementById("resFilterDate").value = "";
    document.getElementById("resFilterUser").value = "all";
    document.getElementById("resFilterResource").value = "all";
    renderReservationTable();
  });
}

function createActionButtons(reservation) {
  let actionsTd = document.createElement("td");

  // Force Confirm Button (the server still refuses it if the whole group does not fit)
  if (
    reservation.status === "pending" ||
    reservation.status === "waiting" ||
    reservation.status === "unallocated" ||
    reservation.status === "waitlisted"
  ) {
    actionsTd.appendChild(
      createButton("Force Confirm", function () {
        updateReservationStatus(reservation.id, "confirmed");
      }),
    );
  }
  // Mark No-show
  if (reservation.status === "confirmed" && !reservation.checkedIn) {
    actionsTd.appendChild(
      createButton("Mark No-show", function () {
        markAsNoShow(reservation.id);
      }),
    );
  }
  // Cancel
  if (
    reservation.status === "pending" ||
    reservation.status === "confirmed" ||
    reservation.status === "waiting" ||
    reservation.status === "unallocated" ||
    reservation.status === "waitlisted"
  ) {
    actionsTd.appendChild(
      createButton("Cancel", function () {
        updateReservationStatus(reservation.id, "cancelled");
      }),
    );
  }
  // Delete
  actionsTd.appendChild(
    createButton("Delete", function () {
      deleteReservation(reservation);
    }),
  );

  return actionsTd;
}

function createButton(text, onClick) {
  let button = document.createElement("button");
  button.innerText = text;
  button.addEventListener("click", onClick);
  return button;
}

// tells the admin when a cancel or a delete gave the free seats to waitlisted requests
function showWaitlistResult(result) {
  if (result && result.data && result.data.waitlistConfirmed > 0) {
    alert(result.data.waitlistConfirmed + " waitlisted request(s) were confirmed with the free seats.");
  }
}

// Force Confirm and Cancel. The server checks if there is a free seat.
async function updateReservationStatus(id, newStatus) {
  try {
    if (newStatus === "confirmed") {
      await apiPost(`/admin/reservations/${id}/confirm`, {});
    } else {
      let result = await apiPost(`/admin/reservations/${id}/cancel`, {});
      showWaitlistResult(result);
    }
  } catch (error) {
    alert(error.message);
  }

  renderReservationTable();
}

async function deleteReservation(reservation) {
  let confirmDelete = confirm(
    `Are you sure you want to delete the reservation for ${getUserName(reservation)} on ${reservation.date}?`
  );
  if (!confirmDelete) return;

  try {
    let result = await apiDelete(`/admin/reservations/${reservation.id}`);
    showWaitlistResult(result);
  } catch (error) {
    alert(error.message);
  }

  renderReservationTable();
}

// The server marks the booking and adds one strike to the user. Nobody is promoted.
async function markAsNoShow(id) {
  try {
    await apiPost(`/admin/reservations/${id}/no-show`, {});
  } catch (error) {
    alert(error.message);
  }

  renderReservationTable();
}

renderReservationTable();
wireReservationFilters();

// the allocation can change the statuses while you are on another tab, so reload when this tab opens
document.addEventListener("adminview:shown", function (e) {
  if (e.detail.view === "reservations") {
    renderReservationTable();
  }
});

// ********************************************************************************************************************************************************
// 2. Admin Resource Management Panel:
// ********************************************************************************************************************************************************

async function renderResourcesTable() {
  let resources;
  try {
    let result = await apiGet("/resources");
    resources = result.data;
  } catch (error) {
    alert(error.message);
    return;
  }
  let tbody = document.getElementById("resourcesTableBody");
  tbody.innerHTML = "";

  resources.forEach((resource) => {
    let row = document.createElement("tr");

    let data = [
      resource.label,
      resource.type.replace("_", " "),
      resource.zone,
      resource.capacity,
      resource.hasSeatMap ? resource.seatCount + " seats" : "No map",
      resource.active === false ? "Inactive" : "Active",
    ];

    data.forEach((value) => {
      let td = document.createElement("td");
      td.innerText = value;
      row.appendChild(td);
    });

    row.appendChild(createResourceButtons(resource));

    tbody.appendChild(row);
  });
}

function createResourceButtons(resource) {
  let actionsTd = document.createElement("td");

  actionsTd.appendChild(
    createButton("Edit", function () {
      loadResourceIntoForm(resource);
    }),
  );

  actionsTd.appendChild(
    createButton("Delete", function () {
      deleteResource(resource);
    }),
  );

  return actionsTd;
}

async function deleteResource(resource) {
  let confirmDelete = confirm(
    `Are you sure you want to delete "${resource.label}"?\nExisting reservations will not be removed.`
  );

  if (confirmDelete) {
    try {
      await apiDelete(`/resources/${resource.id}`);
    } catch (error) {
      // for example: the resource still has upcoming confirmed bookings
      alert(error.message);
    }
    renderResourcesTable();
  }
}

// ---------------------------------------------------------
// Seat map editor (Phase 4)
// The admin draws the seats of a room by clicking squares of a grid. The number of seats becomes the capacity.
// ---------------------------------------------------------

let editorSeats = null;     // null = the room has no seat map. Otherwise an object like { "0,0": true, "0,1": true }
let removeSeatMap = false;  // true when the admin pressed "Remove seat map" for a room that had one

// the name of a seat in the picture, for example "A3": the row letter and the number of the seat in that row
function getEditorLabel(row, col) {
  let number = 0;
  for (let c = 0; c <= col; c++) {
    if (editorSeats[row + "," + c]) {
      number++;
    }
  }
  return String.fromCharCode(65 + row) + number;
}

// what a square looks like in the editor: a seat or an empty place
function getEditorCell(row, col) {
  if (editorSeats[row + "," + col]) {
    return { state: "free", label: getEditorLabel(row, col) };
  }
  return { state: "empty", label: "" };
}

// the admin clicked a square: add the seat, or take it away
function clickEditorCell(row, col) {
  let key = row + "," + col;
  if (editorSeats[key]) {
    delete editorSeats[key];
  } else {
    editorSeats[key] = true;
  }
  drawSeatEditor();
}

// draws the grid again and shows how many seats there are
function drawSeatEditor() {
  let box = document.getElementById("seatEditorBox");
  let capacityInput = document.getElementById("resourceCapacity");

  if (editorSeats === null) {
    box.hidden = true;
    capacityInput.readOnly = false;
    return;
  }

  let rows = Number(document.getElementById("resourceRows").value);
  let cols = Number(document.getElementById("resourceCols").value);
  box.hidden = false;
  drawSeatGrid(document.getElementById("seatEditor"), rows, cols, getEditorCell, clickEditorCell);

  // the capacity is the number of seats, so the field is filled in and locked
  let count = Object.keys(editorSeats).length;
  document.getElementById("seatEditorCount").innerText = "Seats: " + count + " (this number is the capacity)";
  capacityInput.value = count > 0 ? count : 1;
  capacityInput.readOnly = true;
}

// "Draw seat map": a new map starts with every square a seat. If there is a map, the squares outside the new size are dropped
function drawNewMap() {
  let rows = Number(document.getElementById("resourceRows").value);
  let cols = Number(document.getElementById("resourceCols").value);
  if (!Number.isInteger(rows) || rows < 1 || rows > 20 || !Number.isInteger(cols) || cols < 1 || cols > 30) {
    alert("Rows must be from 1 to 20 and columns from 1 to 30.");
    return;
  }

  let oldSeats = editorSeats;
  editorSeats = {};
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let key = row + "," + col;
      if (oldSeats === null || oldSeats[key]) {
        editorSeats[key] = true;
      }
    }
  }
  removeSeatMap = false;
  drawSeatEditor();
}

// "Fill all squares" and "Clear all squares"
function setAllSquares(isSeat) {
  if (editorSeats === null) return;
  let rows = Number(document.getElementById("resourceRows").value);
  let cols = Number(document.getElementById("resourceCols").value);
  editorSeats = {};
  if (isSeat) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        editorSeats[row + "," + col] = true;
      }
    }
  }
  drawSeatEditor();
}

// "Remove seat map": the room goes back to a plain capacity
function removeTheMap() {
  editorSeats = null;
  removeSeatMap = true;
  drawSeatEditor();
}

// the seats of the editor as a list like [{row: 0, col: 0}, ...] for the server
function getEditorCells() {
  let cells = [];
  Object.keys(editorSeats).forEach((key) => {
    let parts = key.split(",");
    cells.push({ row: Number(parts[0]), col: Number(parts[1]) });
  });
  return cells;
}

// the seat map part of the data we send to the server (nothing if the room has no map and none was removed)
function getLayoutToSend() {
  if (editorSeats !== null) {
    return {
      rows: Number(document.getElementById("resourceRows").value),
      cols: Number(document.getElementById("resourceCols").value),
      cells: getEditorCells()
    };
  }
  if (removeSeatMap) {
    return null;
  }
  return undefined;
}

// loads a room into the form. For a room with a seat map we ask the server for the map
async function loadResourceIntoForm(resource) {
  document.getElementById("resourceEditId").value = resource.id;
  document.getElementById("resourceLabel").value = resource.label;
  document.getElementById("resourceType").value = resource.type;
  document.getElementById("resourceZone").value = resource.zone;
  document.getElementById("resourceCapacity").value = resource.capacity;
  document.getElementById("resourceActive").checked = resource.active !== false;

  document.getElementById("resourceSubmitBtn").innerText = "Save Changes";
  document.getElementById("resourceCancelEditBtn").hidden = false;

  editorSeats = null;
  removeSeatMap = false;
  if (resource.hasSeatMap) {
    try {
      let result = await apiGet("/resources/" + resource.id);
      let layout = result.data.layout;
      editorSeats = {};
      layout.seats.forEach((seat) => {
        editorSeats[seat.row + "," + seat.col] = true;
      });
      document.getElementById("resourceRows").value = layout.rows;
      document.getElementById("resourceCols").value = layout.cols;
    } catch (error) {
      alert(error.message);
    }
  }
  drawSeatEditor();
}

function resetResourceForm() {
  document.getElementById("resourceEditId").value = "";

  document.getElementById("resourceForm").reset();
  document.getElementById("resourceCapacity").value = 1;
  document.getElementById("resourceActive").checked = true;
  document.getElementById("resourceSubmitBtn").innerText = "Add Resource";
  document.getElementById("resourceCancelEditBtn").hidden = true;

  editorSeats = null;
  removeSeatMap = false;
  document.getElementById("resourceRows").value = 5;
  document.getElementById("resourceCols").value = 8;
  drawSeatEditor();
}

// returns true when the server accepted it, so the form is only cleared after a success
async function addResource(resource) {
  let newResource = {
    label: resource.label,
    type: resource.type,
    zone: resource.zone,
    capacity: Number(resource.capacity),
    active: resource.active
  };
  let layout = getLayoutToSend();
  if (layout) {
    newResource.layout = layout;
  }

  try {
    await apiPost("/resources", newResource);
  } catch (error) {
    alert(error.message);
    return false;
  }
  renderResourcesTable();
  return true;
}

async function updateResource(id, resource) {
  let changes = {
    label: resource.label,
    type: resource.type,
    zone: resource.zone,
    capacity: Number(resource.capacity),
    active: resource.active
  };
  let layout = getLayoutToSend();
  if (layout !== undefined) {
    changes.layout = layout;
  }

  try {
    await apiPatch(`/resources/${id}`, changes);
  } catch (error) {
    // for example: the room has upcoming bookings, so its seat map cannot change
    alert(error.message);
    return false;
  }
  renderResourcesTable();
  return true;
}

function wireResourceForm() {
  let resourceForm = document.getElementById("resourceForm");

  resourceForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    let id = document.getElementById("resourceEditId").value;

    let resource = {
      label: document.getElementById("resourceLabel").value,
      type: document.getElementById("resourceType").value,
      zone: document.getElementById("resourceZone").value,
      capacity: document.getElementById("resourceCapacity").value,
      active: document.getElementById("resourceActive").checked,
    };

    if (editorSeats !== null && Object.keys(editorSeats).length === 0) {
      alert("Draw at least one seat, or remove the seat map.");
      return;
    }

    let saved = false;
    if (id) {
      saved = await updateResource(id, resource);
    } else {
      saved = await addResource(resource);
    }

    if (saved) {
      resetResourceForm();
    }
  });

  document.getElementById("resourceCancelEditBtn")
    .addEventListener("click", function () {
      resetResourceForm();
    });

  document.getElementById("drawMapBtn").addEventListener("click", drawNewMap);
  document.getElementById("fillMapBtn").addEventListener("click", function () {
    setAllSquares(true);
  });
  document.getElementById("clearMapBtn").addEventListener("click", function () {
    setAllSquares(false);
  });
  document.getElementById("removeMapBtn").addEventListener("click", removeTheMap);
}

renderResourcesTable();
wireResourceForm();



// ********************************************************************************************************************************************************
// 3. Admin User Management Panel:
// ********************************************************************************************************************************************************

let selectedUserId = null;

const ROLE_LABELS = {
  student: "Student",
  faculty: "Faculty",
  librarian: "Librarian",
  admin: "Admin"
};

// ---------------------------------------------------------
// SEARCH
// ---------------------------------------------------------

function wireUserSearch() {
  let searchInput = document.getElementById("userSearchInput");

  searchInput.addEventListener("input", function () {
    renderUserSearchResults(searchInput.value);
  });
}

async function renderUserSearchResults(term) {
  let resultsDiv = document.getElementById("userSearchResults");
  resultsDiv.innerHTML = "";

  let cleanTerm = term.trim().toLowerCase();
  if (!cleanTerm) return;

  let users;
  try {
    let result = await apiGet("/admin/users");
    users = result.data;
  } catch (error) {
    alert(error.message);
    return;
  }
  let matches = users.filter((user) =>
    user.name.toLowerCase().includes(cleanTerm)
  );

  if (matches.length === 0) {
    let empty = document.createElement("div");
    empty.className = "search-result-row";
    empty.innerText = "No users found.";
    resultsDiv.appendChild(empty);
    return;
  }

  matches.forEach((user) => {
    let row = document.createElement("div");
    row.className = "search-result-row";

    let left = document.createElement("span");
    left.innerText = user.name;

    let right = document.createElement("span");
    right.className = "tag";
    right.innerText = ROLE_LABELS[user.role] || user.role;

    row.appendChild(left);
    row.appendChild(right);

    row.addEventListener("click", function () {
      openUserProfile(user.id);
    });

    resultsDiv.appendChild(row);
  });
}

// ---------------------------------------------------------
// PROFILE
// ---------------------------------------------------------

async function openUserProfile(userId) {
  selectedUserId = userId;

  // there is no "one user" route for admins, so we pick the user from the list
  let user;
  try {
    let result = await apiGet("/admin/users");
    user = result.data.find((u) => String(u.id) === String(userId));
  } catch (error) {
    alert(error.message);
    return;
  }
  if (!user) return;

  document.getElementById("section-user-profile").hidden = false;

  document.getElementById("userProfileName").innerText = user.name;
  document.getElementById("userProfileRole").innerText =
    ROLE_LABELS[user.role] || user.role;
  document.getElementById("userProfileNoShows").innerText =
    user.noShowCount || 0;
  document.getElementById("userProfileReliability").innerText =
    user.priority ? user.priority.reliabilityScore + " / 10" : "—";

  renderPriorityBreakdown(user);
  renderUserBookingHistory(userId);
  renderSuspendStatus(user);
}

// The numbers come from the server (user.priority in /admin/users). Nothing is calculated here.
// Inside the same purpose tier the request with the higher score is allocated first.
function renderPriorityBreakdown(user) {
  let breakdownList = document.getElementById("userProfilePriorityBreakdown");
  breakdownList.innerHTML = "";

  let priority = user.priority || { roleScore: 0, reliabilityScore: 0, recentNoShows: 0 };
  let roleMax = user.role === "faculty" ? 15 : 10;
  let total = priority.roleScore + priority.reliabilityScore;

  let rows = [
    { label: "Role (" + (ROLE_LABELS[user.role] || user.role) + ")", value: priority.roleScore + " / " + roleMax },
    { label: "Reliability (no-shows in the last 90 days: " + priority.recentNoShows + ")", value: priority.reliabilityScore + " / 10" },
    { label: "Score inside the purpose tier", value: total },
  ];

  rows.forEach((row) => {
    let li = document.createElement("li");

    let left = document.createElement("span");
    left.innerText = row.label;

    let right = document.createElement("span");
    right.innerText = row.value;

    li.appendChild(left);
    li.appendChild(right);
    breakdownList.appendChild(li);
  });
}

// ---------------------------------------------------------
// BOOKING HISTORY
// ---------------------------------------------------------

async function renderUserBookingHistory(userId) {
  let reservations = [];
  try {
    let result = await apiGet("/admin/reservations");
    reservations = result.data;
  } catch (error) {
    alert(error.message);
  }
  let userReservations = reservations.filter((r) => r.user && String(r.user.id) === String(userId));

  userReservations.sort((a, b) => {
    return getDateTime(b) - getDateTime(a); // most recent first
  });

  let tbody = document.getElementById("userBookingHistoryTableBody");
  let emptyNote = document.getElementById("userHistoryEmptyNote");
  tbody.innerHTML = "";

  emptyNote.hidden = userReservations.length > 0;

  userReservations.forEach((reservation) => {
    let row = document.createElement("tr");

    let data = [
      getResourceLabel(reservation),
      reservation.date,
      reservation.startTime + " - " + reservation.endTime,
      reservation.status,
    ];

    data.forEach((value) => {
      let td = document.createElement("td");
      td.innerText = value;
      row.appendChild(td);
    });

    tbody.appendChild(row);
  });
}


// ---------------------------------------------------------
// ACCESS CONTROL (suspend / unsuspend)
// ---------------------------------------------------------

function renderSuspendStatus(user) {
  let statusEl = document.getElementById("userSuspendStatus");
  let form = document.getElementById("userSuspendForm");
  let unsuspendBtn = document.getElementById("userUnsuspendBtn");

  if (user.suspended) {
    let untilText = user.suspendedUntil
      ? "until " + user.suspendedUntil.slice(0, 10)
      : "indefinitely";
    let reasonText = user.suspendReason ? " — " + user.suspendReason : "";

    statusEl.innerText = "Suspended " + untilText + reasonText;
    form.hidden = true;
    unsuspendBtn.hidden = false;
  } else {
    statusEl.innerText = "Not suspended.";
    form.hidden = false;
    unsuspendBtn.hidden = true;
  }
}

async function suspendUser(userId, durationValue, reason) {
  // days is 1, 7, 30 or null (no end date). The server calculates the end date.
  let days = durationValue === "indefinite" ? null : Number(durationValue);

  try {
    let result = await apiPost(`/admin/users/${userId}/suspend`, { days: days, reason: reason });
    renderSuspendStatus(result.data);
  } catch (error) {
    alert(error.message);
  }
}

async function unsuspendUser(userId) {
  try {
    let result = await apiPost(`/admin/users/${userId}/unsuspend`, {});
    renderSuspendStatus(result.data);
  } catch (error) {
    alert(error.message);
  }
}

function wireSuspendControls() {
  let form = document.getElementById("userSuspendForm");
  let unsuspendBtn = document.getElementById("userUnsuspendBtn");

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    if (!selectedUserId) return;

    let duration = document.getElementById("userSuspendDuration").value;
    let reason = document.getElementById("userSuspendReason").value;

    suspendUser(selectedUserId, duration, reason);
    form.reset();
  });

  unsuspendBtn.addEventListener("click", function () {
    if (!selectedUserId) return;
    unsuspendUser(selectedUserId);
  });
}

wireUserSearch();
wireSuspendControls();

// ********************************************************************************************************************************************************
// 4. Admin Dashboard Panel:
// ********************************************************************************************************************************************************

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function isHappeningNow(reservation) {
  if (reservation.status !== "confirmed") return false;

  let today = getTodayDate();
  if (reservation.date !== today) return false;

  let now = new Date();
  let start = new Date(today + "T" + reservation.startTime);
  let end = new Date(today + "T" + reservation.endTime);

  return now >= start && now <= end;
}

function showAdminToast(msg) {
  let container = document.getElementById("adminToastContainer");
  if (!container) return;
  let toast = document.createElement("div");
  toast.className = "toast-msg";
  toast.innerText = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// all messages come from the server (the admin gets every message)
async function getGuardianMessages() {
  try {
    let result = await apiGet("/messages");
    return result.data;
  } catch (error) {
    alert(error.message);
    return [];
  }
}

async function renderGuardianMessages() {
  const container = document.getElementById("guardianMessagesContainer");
  const emptyNote = document.getElementById("guardianMessagesEmptyNote");
  const filterVal = document.getElementById("guardianMsgFilter")?.value || "all";
  if (!container) return;

  let msgs = await getGuardianMessages();

  if (filterVal === "unread") {
    msgs = msgs.filter(m => m.status === "unread");
  } else if (filterVal === "guardian") {
    msgs = msgs.filter(m => (m.subject || "").toLowerCase().includes("guardian"));
  }

  container.innerHTML = "";
  if (emptyNote) emptyNote.hidden = msgs.length > 0;

  msgs.forEach(msg => {
    const card = document.createElement("div");
    const isUnread = msg.status === "unread";
    card.className = `guardian-msg-card ${isUnread ? "msg-unread" : "msg-read"}`;

    card.innerHTML = `
      <div class="msg-card-header">
        <div class="msg-student-info">
          <div class="msg-avatar">${(msg.name || "S")[0].toUpperCase()}</div>
          <div>
            <div class="msg-student-name">
              ${escapeHtml(msg.name)} 
              <span class="role-badge">${escapeHtml(msg.role || "student")}</span>
            </div>
            <div class="msg-student-meta">
              <span class="meta-pill">ID: <strong>${escapeHtml(msg.studentId || "N/A")}</strong></span>
              <span class="meta-pill">${escapeHtml(msg.department || "General")} (${escapeHtml(msg.semester || "Sem 1")})</span>
              <span class="meta-email">✉️ ${escapeHtml(msg.email)}</span>
            </div>
          </div>
        </div>
        <div class="msg-card-badges">
          <span class="subject-badge">${escapeHtml(msg.subject || "General Inquiry")}</span>
          <span class="status-badge ${isUnread ? 'badge-unread' : 'badge-read'}">
            ${isUnread ? '● UNREAD' : '✓ RESOLVED'}
          </span>
        </div>
      </div>

      <div class="msg-body-box">
        <p>${escapeHtml(msg.message)}</p>
      </div>

      <div class="msg-card-footer">
        <span class="msg-time">🕒 ${escapeHtml(msg.timestamp || "Recently")}</span>
        <div class="msg-actions">
          ${isUnread ? `<button type="button" class="btn-msg-resolve" onclick="markGuardianMsgRead('${msg.id}')">✓ Mark Resolved</button>` : ''}
          <button type="button" class="btn-msg-delete" onclick="deleteGuardianMsg('${msg.id}')">🗑️ Delete</button>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

window.markGuardianMsgRead = async function(id) {
  try {
    await apiPatch(`/messages/${id}`, { status: 'read' });
    showAdminToast("✓ Message marked as resolved");
  } catch (error) {
    alert(error.message);
  }
  renderDashboard();
};

window.markAllGuardianMsgsRead = async function() {
  let msgs = await getGuardianMessages();
  let unread = msgs.filter(m => m.status === 'unread');

  try {
    for (let i = 0; i < unread.length; i++) {
      await apiPatch(`/messages/${unread[i].id}`, { status: 'read' });
    }
    showAdminToast("✓ All Guardian messages marked as read");
  } catch (error) {
    alert(error.message);
  }
  renderDashboard();
};

window.deleteGuardianMsg = async function(id) {
  try {
    await apiDelete(`/messages/${id}`);
    showAdminToast("🗑️ Message deleted");
  } catch (error) {
    alert(error.message);
  }
  renderDashboard();
};

async function renderDashboardStats() {
  let reservations = [];
  try {
    let result = await apiGet("/admin/reservations");
    reservations = result.data;
  } catch (e) {
    reservations = [];
  }
  let today = getTodayDate();

  let totalToday = reservations.filter((r) => r.date === today).length;
  let pendingCount = reservations.filter((r) => r.status === "pending").length;
  let unallocatedCount = reservations.filter((r) => r.status === "unallocated").length;
  let noShowsToday = reservations.filter(
    (r) => r.date === today && r.status === "no_show"
  ).length;
  let liveNow = reservations.filter(isHappeningNow).length;

  let msgs = await getGuardianMessages();
  let unreadMsgs = msgs.filter(m => m.status === 'unread').length;

  if (document.getElementById("statTotalToday")) document.getElementById("statTotalToday").innerText = totalToday;
  if (document.getElementById("statLiveNow")) document.getElementById("statLiveNow").innerText = liveNow;
  if (document.getElementById("statPending")) document.getElementById("statPending").innerText = pendingCount;
  if (document.getElementById("statUnallocated")) document.getElementById("statUnallocated").innerText = unallocatedCount;
  if (document.getElementById("statNoShowsToday")) document.getElementById("statNoShowsToday").innerText = noShowsToday;
  if (document.getElementById("statGuardianMsgs")) document.getElementById("statGuardianMsgs").innerText = unreadMsgs;
}

async function renderLiveBookings() {
  let reservations = [];
  try {
    let result = await apiGet("/admin/reservations");
    reservations = result.data;
  } catch (e) {}
  let liveReservations = reservations.filter(isHappeningNow);

  let tbody = document.getElementById("liveBookingsTableBody");
  let emptyNote = document.getElementById("liveBookingsEmptyNote");
  if (tbody) {
    tbody.innerHTML = "";
    if (emptyNote) emptyNote.hidden = liveReservations.length > 0;

    liveReservations.forEach((reservation) => {
      let row = document.createElement("tr");

      let data = [
        getUserName(reservation),
        getResourceLabel(reservation),
        reservation.startTime,
        reservation.endTime,
        reservation.checkedIn ? "Yes" : "No",
      ];

      data.forEach((value) => {
        let td = document.createElement("td");
        td.innerText = value;
        row.appendChild(td);
      });

      tbody.appendChild(row);
    });
  }
}

function renderDashboard() {
  renderDashboardStats();
  renderLiveBookings();
  renderGuardianMessages();
}

renderDashboard();
document.addEventListener("adminview:shown", function (e) {
  if (e.detail.view === "dashboard") {
    renderDashboard();
  }
});

// ********************************************************************************************************************************************************
// 5. Admin Settings — Exam Window Management:
// ********************************************************************************************************************************************************

let EXAM_KINDS = {
  mid_semester_exam: "Mid semester exam",
  end_semester_exam: "End semester exam",
  other: "Other"
};

async function getExamWindows() {
  try {
    let result = await apiGet("/exam-windows");
    return result.data;
  } catch (error) {
    alert(error.message);
    return [];
  }
}



async function renderExamWindowsTable() {
  let windows = await getExamWindows();
  let tbody = document.getElementById("examWindowsTableBody");
  tbody.innerHTML = "";

  windows.forEach((window) => {
    let row = document.createElement("tr");

    let data = [window.startDate, window.endDate, EXAM_KINDS[window.kind] || "Other"];

    data.forEach((value) => {
      let td = document.createElement("td");
      td.innerText = value;
      row.appendChild(td);
    });

    let actionsTd = document.createElement("td");
    actionsTd.appendChild(
      createButton("Remove", function () {
        removeExamWindow(window.id);
      })
    );
    row.appendChild(actionsTd);

    tbody.appendChild(row);
  });
}

async function removeExamWindow(id) {
  try {
    await apiDelete(`/exam-windows/${id}`);
  } catch (error) {
    alert(error.message);
  }
  renderExamWindowsTable();
}

function wireExamWindowForm() {
  let form = document.getElementById("examWindowForm");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    let start = document.getElementById("examStart").value;
    let end = document.getElementById("examEnd").value;

    if (!start || !end || start > end) {
      alert("Pick a valid start and end date (start must be before end).");
      return;
    }

    let newWindow = {
      title: "Exam Window " + start + " to " + end,
      startDate: start,
      endDate: end,
      kind: document.getElementById("examKind").value
    };

    try {
      await apiPost("/exam-windows", newWindow);
    } catch (error) {
      alert(error.message);
      return;
    }

    form.reset();
    renderExamWindowsTable();
  });
}

renderExamWindowsTable();
wireExamWindowForm();

