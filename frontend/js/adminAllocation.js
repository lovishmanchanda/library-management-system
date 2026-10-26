// adminAllocation.js => the Allocation tab of the admin panel (Phase 2).
// The admin picks a date and runs the allocation. The server ranks the requests of that date
// (purpose first, then score) and allocates them. This file only shows what the server answers.
// It needs js/api.js and the section #allocationRoot of admin.html.

let PURPOSE_LABELS = {
  job_interview: "Job interview",
  end_semester_exam: "End semester exam",
  mid_semester_exam: "Mid semester exam",
  quarterly_test: "Quarterly test",
  project_work: "Project work",
  general_study: "General study"
};

// ---- the page (form, summary, tables) ----

function buildAllocationPage() {
  let root = document.getElementById("allocationRoot");
  if (!root) return;

  root.innerHTML = `
    <form id="allocationForm" class="inline-form">
      <label>
        Booking date
        <input type="date" id="allocationDate" required>
      </label>
      <button type="submit" id="allocationRunBtn">Run allocation</button>
    </form>

    <p class="hint" id="allocationSummary"></p>

    <!-- decisions -->
    <table class="admin-table" id="allocationDecisionsTable" hidden>
      <thead>
        <tr>
          <th>Student</th>
          <th>Resource</th>
          <th>Time</th>
          <th>Purpose</th>
          <th>Group</th>
          <th>Seats</th>
          <th>Tier</th>
          <th>Score</th>
          <th>Result</th>
          <th>Offer</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody id="allocationDecisionsBody"></tbody>
    </table>
    <!-- /decisions -->

    <!-- history -->
    <h3>Run history</h3>
    <table class="admin-table" id="allocationRunsTable">
      <thead>
        <tr>
          <th>Date</th>
          <th>Run by</th>
          <th>Run at</th>
          <th>Considered</th>
          <th>Confirmed</th>
          <th>Unallocated</th>
          <th>Offers</th>
        </tr>
      </thead>
      <tbody id="allocationRunsBody"></tbody>
    </table>
    <p class="empty-note" id="allocationRunsEmpty" hidden>No allocation has been run yet.</p>
    <!-- /history -->
  `;
}

// puts a list of texts in a table row
function addAllocationRow(tbody, values) {
  let row = document.createElement("tr");
  values.forEach((value) => {
    let td = document.createElement("td");
    td.innerText = value;
    row.appendChild(td);
  });
  tbody.appendChild(row);
}

// ---- the result of a run ----

function showAllocationSummary(run) {
  document.getElementById("allocationSummary").innerText =
    "Allocation for " + run.date + ": " + run.considered + " request(s) considered, " +
    run.confirmed + " newly confirmed, " + run.unallocated + " unallocated, " +
    (run.offers || 0) + " alternative offer(s) made.";
}

// the offer of a request as short text, for example "offered (Study Room B2)"
function offerText(offer) {
  if (!offer) return "-";
  return offer.resource ? offer.status + " (" + offer.resource + ")" : offer.status;
}

// ---- decisions table ----

function showAllocationDecisions(decisions) {
  let table = document.getElementById("allocationDecisionsTable");
  let tbody = document.getElementById("allocationDecisionsBody");
  tbody.innerHTML = "";
  table.hidden = decisions.length === 0;

  decisions.forEach((d) => {
    addAllocationRow(tbody, [
      d.user,
      d.resource,
      d.startTime + " - " + d.endTime,
      PURPOSE_LABELS[d.purpose] || d.purpose,
      d.groupSize,
      d.seats && d.seats.length > 0 ? d.seats.join(", ") : "-",
      d.tier,
      d.score,
      d.status,
      offerText(d.offer),
      d.reason || ""
    ]);
  });
}

// ---- run history ----

async function loadAllocationRuns() {
  let tbody = document.getElementById("allocationRunsBody");
  let emptyNote = document.getElementById("allocationRunsEmpty");
  if (!tbody) return;

  let runs = [];
  try {
    let result = await apiGet("/admin/allocation-runs");
    runs = result.data;
  } catch (error) {
    alert(error.message);
    return;
  }

  tbody.innerHTML = "";
  emptyNote.hidden = runs.length > 0;
  runs.forEach((run) => {
    addAllocationRow(tbody, [
      run.date,
      run.ranBy,
      new Date(run.ranAt).toLocaleString(),
      run.considered,
      run.confirmed,
      run.unallocated,
      run.offers || 0
    ]);
  });
}

// ---- run button ----

async function runAllocationForDate(date) {
  let button = document.getElementById("allocationRunBtn");
  button.disabled = true;

  try {
    let result = await apiPost("/admin/allocate", { date: date });
    showAllocationSummary(result.data.run);
    showAllocationDecisions(result.data.decisions);
    loadAllocationRuns();
  } catch (error) {
    alert(error.message);
  }

  button.disabled = false;
}

function wireAllocationForm() {
  document.getElementById("allocationForm").addEventListener("submit", function (e) {
    e.preventDefault();
    let date = document.getElementById("allocationDate").value;
    if (!date) {
      alert("Pick a booking date first.");
      return;
    }
    runAllocationForDate(date);
  });
}

buildAllocationPage();
wireAllocationForm();
loadAllocationRuns();

// reload the history each time the tab is opened
document.addEventListener("adminview:shown", function (e) {
  if (e.detail.view === "allocation") {
    loadAllocationRuns();
  }
});
