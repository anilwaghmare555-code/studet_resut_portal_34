/* ===========================
   CONFIG: Update these values
   =========================== */

/**
 * Publish your Google Sheet to CSV:
 * File → Share → Publish to web → Select the sheet → CSV → Copy link.
 * Paste that CSV link below.
 */
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRFVN8EDr0a9J77nYie384V7VpkPjgo93r8b3f58SeEYLo8pxg05wpDIhodySW2q_h1ByPIggbHPJfw/pub?gid=0&single=true&output=csv";

/**
 * Tell the app which column headers represent Class, Division, and Roll No.
 * It will match case-insensitively and also try common alternatives automatically.
 */
const COLUMN_ALIASES = {
  class: ["class", "std", "grade"],
  division: ["division", "div", "section"],
  roll: ["roll", "rollno", "roll no", "roll number", "roll_number"]
};

/* =============== App State =============== */
let rows = [];           // Array of objects (each object = row)
let headers = [];        // Header names (as in CSV)
let idx = {              // Resolved column names used for filters
  class: null,
  division: null,
  roll: null
};

/* =============== DOM Refs =============== */
const classSelect = document.getElementById("classSelect");
const divSelect   = document.getElementById("divSelect");
const rollSelect  = document.getElementById("rollSelect");
const clearBtn    = document.getElementById("clearBtn");
const statusBox   = document.getElementById("status");
const card        = document.getElementById("resultCard");
const tableEl     = document.getElementById("resultTable");
const noMatch     = document.getElementById("noMatch");
const printBtn    = document.getElementById("printBtn");

/* =============== Utils =============== */

// Robust CSV parser supporting quoted fields and commas within quotes
function parseCSV(text) {
  const out = [];
  let row = [];
  let field = "";
  let i = 0, inQuotes = false;

  while (i < text.length) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"'; // escaped quote
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }

    if (!inQuotes && (char === "," || char === "\t")) {
      row.push(field);
      field = "";
      i++;
      continue;
    }

    if (!inQuotes && (char === "\r" || char === "\n")) {
      if (field !== "" || row.length) {
        row.push(field);
        out.push(row);
        row = [];
        field = "";
      }
      // consume \r\n pair
      if (char === "\r" && text[i + 1] === "\n") i++;
      i++;
      continue;
    }

    field += char;
    i++;
  }
  if (field !== "" || row.length) {
    row.push(field);
    out.push(row);
  }
  return out;
}

function toObjects(matrix) {
  const head = matrix[0] || [];
  const data = matrix.slice(1);
  return {
    headers: head,
    rows: data.map(r => {
      const obj = {};
      head.forEach((h, i) => { obj[h] = r[i] ?? ""; });
      return obj;
    })
  };
}

function normalize(s) {
  return String(s || "").trim();
}
function lower(s) {
  return normalize(s).toLowerCase();
}

function resolveColumns(headers, aliases) {
  const found = { class: null, division: null, roll: null };
  const lowerHeaders = headers.map(h => lower(h));

  for (const key of ["class", "division", "roll"]) {
    // try alias list
    for (const candidate of aliases[key]) {
      const idx = lowerHeaders.indexOf(candidate);
      if (idx !== -1) { found[key] = headers[idx]; break; }
    }
    // last resort: partial contains
    if (!found[key]) {
      const match = headers.find(h => lower(h).includes(key));
      if (match) found[key] = match;
    }
  }
  return found;
}

function uniqueSorted(values) {
  return [...new Set(values.map(v => normalize(v)).filter(Boolean))].sort((a,b)=>{
    // numeric-friendly sort
    const na = Number(a), nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.localeCompare(b, undefined, { numeric:true, sensitivity:"base" });
  });
}

/* =============== Rendering =============== */

function setStatus(msg, isError=false) {
  if (!msg) { statusBox.classList.add("hidden"); return; }
  statusBox.classList.remove("hidden");
  statusBox.textContent = msg;
  statusBox.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function fillSelect(select, values, placeholder="Select") {
  select.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder;
  select.appendChild(opt0);

  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
  select.disabled = values.length === 0;
}

function renderTable(rowObj) {
  tableEl.innerHTML = "";

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  headers.forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  const tbody = document.createElement("tbody");
  const tr = document.createElement("tr");
  headers.forEach(h => {
    const td = document.createElement("td");
    td.textContent = rowObj[h] ?? "";
    tr.appendChild(td);
  });
  tbody.appendChild(tr);

  tableEl.appendChild(thead);
  tableEl.appendChild(tbody);
}

/* =============== Interactions =============== */

function cascadePopulate() {
  // Populate Class
  const classes = uniqueSorted(rows.map(r => r[idx.class]));
  fillSelect(classSelect, classes, "Select class");
  divSelect.disabled = true;
  rollSelect.disabled = true;
}

function onClassChange() {
  const cls = classSelect.value;
  if (!cls) {
    fillSelect(divSelect, [], "Select class first");
    fillSelect(rollSelect, [], "Select class & division first");
    card.classList.add("hidden");
    noMatch.classList.add("hidden");
    return;
  }
  const filtered = rows.filter(r => normalize(r[idx.class]) === normalize(cls));
  const divs = uniqueSorted(filtered.map(r => r[idx.division]));
  fillSelect(divSelect, divs, "Select division");
  fillSelect(rollSelect, [], "Select division first");
  card.classList.add("hidden");
  noMatch.classList.add("hidden");
}

function onDivisionChange() {
  const cls = classSelect.value;
  const div = divSelect.value;
  if (!cls || !div) {
    fillSelect(rollSelect, [], "Select class & division first");
    card.classList.add("hidden");
    noMatch.classList.add("hidden");
    return;
  }
  const filtered = rows.filter(r =>
    normalize(r[idx.class]) === normalize(cls) &&
    normalize(r[idx.division]) === normalize(div)
  );
  const rolls = uniqueSorted(filtered.map(r => r[idx.roll]));
  fillSelect(rollSelect, rolls, "Select roll no.");
  card.classList.add("hidden");
  noMatch.classList.add("hidden");
}

function onRollChange() {
  const cls = classSelect.value;
  const div = divSelect.value;
  const roll = rollSelect.value;
  if (!cls || !div || !roll) {
    card.classList.add("hidden");
    noMatch.classList.add("hidden");
    return;
  }
  const match = rows.find(r =>
    normalize(r[idx.class]) === normalize(cls) &&
    normalize(r[idx.division]) === normalize(div) &&
    normalize(r[idx.roll]) === normalize(roll)
  );

  if (match) {
    renderTable(match);
    card.classList.remove("hidden");
    noMatch.classList.add("hidden");
  } else {
    card.classList.add("hidden");
    noMatch.classList.remove("hidden");
  }
}

function clearFilters() {
  classSelect.selectedIndex = 0;
  divSelect.innerHTML = `<option value="">Select class first</option>`;
  rollSelect.innerHTML = `<option value="">Select class & division first</option>`;
  divSelect.disabled = true;
  rollSelect.disabled = true;
  card.classList.add("hidden");
  noMatch.classList.add("hidden");
}

/* =============== Bootstrap =============== */

async function init() {
  setStatus("Fetching data…");
  try {
    if (!CSV_URL || CSV_URL.includes("XXXX")) {
      throw new Error("Please set CSV_URL in script.js to your published Google Sheet CSV link.");
    }

    const res = await fetch(CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to fetch CSV (${res.status})`);

    const text = await res.text();
    const matrix = parseCSV(text);
    if (!matrix.length) throw new Error("CSV appears empty.");
    const { headers: hdrs, rows: objs } = toObjects(matrix);

    headers = hdrs;
    rows = objs;

    // Resolve required columns
    idx = resolveColumns(headers, COLUMN_ALIASES);
    if (!idx.class || !idx.division || !idx.roll) {
      const msg = [
        "Could not detect required columns.",
        "Expected headers similar to:",
        `Class → one of [${COLUMN_ALIASES.class.join(", ")}]`,
        `Division → one of [${COLUMN_ALIASES.division.join(", ")}]`,
        `Roll No → one of [${COLUMN_ALIASES.roll.join(", ")}]`,
        "",
        "Actual headers found:",
        headers.join(", ")
      ].join("\n");
      throw new Error(msg);
    }

    // Populate first dropdown
    cascadePopulate();

    // Enable selects & bind events
    classSelect.disabled = false;
    classSelect.addEventListener("change", onClassChange);
    divSelect.addEventListener("change", onDivisionChange);
    rollSelect.addEventListener("change", onRollChange);
    clearBtn.addEventListener("click", clearFilters);
    printBtn.addEventListener("click", () => window.print());

    setStatus(""); // clear
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Something went wrong loading data.", true);
    // Keep controls disabled to avoid confusion
  }
}

document.addEventListener("DOMContentLoaded", init);
