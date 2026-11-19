/** Fixture pages and their deterministic checkers for the browser observation benchmark. */

export type Group = "app" | "content" | "form" | "frames"

export type Recorded = { kind: string; data: Record<string, unknown> }

export type Outcome = { records: Recorded[]; answer: string }

export type Task = {
  id: string
  group: Group
  title: string
  /** What the model is asked to do. The runner prepends the fixture URL. */
  instruction: string
  /** What a correct run produces, for the report. */
  expected: string
  check: (outcome: Outcome) => boolean
}

const record = (outcome: Outcome, kind: string) => outcome.records.filter((item) => item.kind === kind).at(-1)

function page(id: string, title: string, body: string, script = "") {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:940px;margin:2rem auto;padding:0 1rem;color:#111;line-height:1.45}
h1{font-size:1.6rem}h2{font-size:1.2rem;margin-top:2rem}h3{font-size:1rem}
table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.92rem}
th,td{border-bottom:1px solid #ddd;padding:.35rem .6rem;text-align:left}
button{padding:.35rem .8rem;margin:.15rem;cursor:pointer}
label{display:block;margin:.7rem 0 .2rem;font-weight:600}
input,select{padding:.3rem;min-width:220px}
.error{color:#b00020}.ok{color:#00701a}.muted{color:#666}
fieldset{border:1px solid #ccc;margin:1rem 0;padding:1rem}
iframe{border:1px solid #999;width:100%;height:220px}
</style></head>
<body><main>${body}</main>
<script>
const TASK = ${JSON.stringify(id)};
async function record(kind, data) {
  await fetch("/__record", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task: TASK, kind: kind, data: data })
  });
}
${script}
</script></body></html>`
}

/* ------------------------------- group A: local app ------------------------------- */

const todos = [
  { name: "Write release notes", done: false },
  { name: "Review PR 412", done: true },
  { name: "Update changelog", done: false },
  { name: "Tag v7.8.30", done: true },
  { name: "Announce in Slack", done: false },
]

const a1 = page(
  "a1-todo",
  "Launch checklist",
  `<h1>Launch checklist</h1>
<p class="muted">Tick the items you finish. The counter updates as you go.</p>
<ul id="list">${todos
    .map(
      (item, index) =>
        `<li><label style="font-weight:400"><input type="checkbox" data-index="${index}" ${
          item.done ? "checked" : ""
        }> ${item.name}</label></li>`,
    )
    .join("")}</ul>
<p>Open items: <strong id="open">${todos.filter((item) => !item.done).length}</strong></p>`,
  `function refresh() {
  const boxes = Array.from(document.querySelectorAll("input[type=checkbox]"));
  const done = boxes.filter(function (box) { return box.checked }).map(function (box) {
    return document.querySelectorAll("li")[Number(box.dataset.index)].textContent.trim();
  });
  document.getElementById("open").textContent = String(boxes.length - done.length);
  record("todo", { done: done });
}
document.querySelectorAll("input[type=checkbox]").forEach(function (box) {
  box.addEventListener("change", refresh);
});`,
)

const products = [
  { id: "widget-pro", name: "Widget Pro", price: 49.5 },
  { id: "cable-kit", name: "Cable Kit", price: 12.25 },
  { id: "stand", name: "Monitor Stand", price: 35 },
  { id: "dock", name: "USB-C Dock", price: 89.99 },
]

const a2 = page(
  "a2-cart",
  "Parts shop",
  `<h1>Parts shop</h1>
<table><thead><tr><th>Product</th><th>Price</th><th></th></tr></thead><tbody>${products
    .map(
      (item) =>
        `<tr data-id="${item.id}"><td>${item.name}</td><td>$${item.price.toFixed(2)}</td><td><button data-add="${
          item.id
        }">Add to cart</button></td></tr>`,
    )
    .join("")}</tbody></table>
<h2>Cart</h2>
<ul id="cart"><li class="muted">Cart is empty</li></ul>
<p>Total: <strong id="total">$0.00</strong></p>
<button id="order">Place order</button>
<p id="status" class="ok"></p>`,
  `const catalog = ${JSON.stringify(products)};
const cart = [];
function draw() {
  const list = document.getElementById("cart");
  if (cart.length === 0) { list.innerHTML = '<li class="muted">Cart is empty</li>'; }
  else { list.innerHTML = cart.map(function (item) {
    return "<li>" + item.name + " — $" + item.price.toFixed(2) + "</li>";
  }).join(""); }
  const total = cart.reduce(function (sum, item) { return sum + item.price }, 0);
  document.getElementById("total").textContent = "$" + total.toFixed(2);
  return total;
}
document.querySelectorAll("button[data-add]").forEach(function (button) {
  button.addEventListener("click", function () {
    const item = catalog.find(function (entry) { return entry.id === button.dataset.add });
    cart.push(item);
    draw();
  });
});
document.getElementById("order").addEventListener("click", async function () {
  const total = draw();
  await record("order", { items: cart.map(function (item) { return item.id }), total: total });
  document.getElementById("status").textContent = "Order placed.";
});`,
)

const a3 = page(
  "a3-settings",
  "Workspace settings",
  `<h1>Workspace settings</h1>
<label><input type="checkbox" id="dark"> Dark mode</label>
<label for="language">Interface language</label>
<select id="language"><option value="en">English</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="es">Español</option></select>
<label for="timezone">Time zone</label>
<select id="timezone"><option>UTC</option><option>Europe/Berlin</option><option>America/New_York</option></select>
<label><input type="checkbox" id="digest"> Weekly digest email</label>
<p><button id="save">Save settings</button></p>
<p id="status" class="ok"></p>`,
  `document.getElementById("save").addEventListener("click", async function () {
  const values = {
    dark: document.getElementById("dark").checked,
    language: document.getElementById("language").value,
    timezone: document.getElementById("timezone").value,
    digest: document.getElementById("digest").checked
  };
  await record("settings", values);
  document.getElementById("status").textContent = "Settings saved.";
});`,
)

const orders = [
  { id: "ORD-1021", status: "paid", amount: 240 },
  { id: "ORD-1022", status: "failed", amount: 90 },
  { id: "ORD-1023", status: "paid", amount: 310 },
  { id: "ORD-1024", status: "refunded", amount: 45 },
  { id: "ORD-1040", status: "failed", amount: 120 },
  { id: "ORD-1041", status: "paid", amount: 75 },
  { id: "ORD-1042", status: "failed", amount: 61.5 },
  { id: "ORD-1043", status: "pending", amount: 18 },
]

const a4 = page(
  "a4-orders",
  "Orders",
  `<h1>Orders</h1>
<label for="filter">Filter by status</label>
<select id="filter"><option value="all">all</option><option value="paid">paid</option><option value="failed">failed</option><option value="refunded">refunded</option><option value="pending">pending</option></select>
<table><thead><tr><th>Order</th><th>Status</th><th>Amount</th></tr></thead><tbody>${orders
    .map(
      (order) =>
        `<tr data-status="${order.status}"><td>${order.id}</td><td>${order.status}</td><td>$${order.amount}</td></tr>`,
    )
    .join("")}</tbody></table>`,
  `document.getElementById("filter").addEventListener("change", function () {
  const value = document.getElementById("filter").value;
  document.querySelectorAll("tbody tr").forEach(function (row) {
    row.style.display = value === "all" || row.dataset.status === value ? "" : "none";
  });
});`,
)

const a5 = page(
  "a5-basket",
  "Product page",
  `<h1>Field Notebook</h1>
<p class="muted">A5, dotted paper, 160 pages. $14.00 each.</p>
<label for="name">Label for this order</label>
<input id="name" type="text" placeholder="Your name">
<div style="margin:1rem 0">
  Quantity
  <button id="minus">-</button>
  <strong id="qty">1</strong>
  <button id="plus">+</button>
</div>
<p><button id="add">Add to basket</button></p>
<p id="status" class="ok"></p>`,
  `let quantity = 1;
const label = document.getElementById("qty");
document.getElementById("plus").addEventListener("click", function () {
  quantity = quantity + 1; label.textContent = String(quantity);
});
document.getElementById("minus").addEventListener("click", function () {
  if (quantity > 1) { quantity = quantity - 1; label.textContent = String(quantity); }
});
document.getElementById("add").addEventListener("click", async function () {
  const name = document.getElementById("name").value;
  await record("basket", { name: name, quantity: quantity });
  document.getElementById("status").textContent = "Added to basket.";
});`,
)

/* ------------------------------- group B: long content ------------------------------- */

const policySections = [
  [
    "1. Scope",
    "This policy covers every workspace, project, and personal account on the platform. It applies to data created through the web application, the command line client, and the API.",
  ],
  [
    "2. Data classes",
    "We store three classes of data: workspace content, operational telemetry, and security records. Each class has its own retention window and deletion procedure.",
  ],
  [
    "3. Session recordings",
    "Interactive session recordings are kept for 30 days after the session ends. After that window the recordings are deleted by a scheduled job and cannot be restored.",
  ],
  [
    "4. Audit logs",
    "Audit logs record sign-ins, permission changes, and administrative actions. Audit logs are retained for 400 days. Customers on the Enterprise plan can export them at any time.",
  ],
  [
    "5. Backups",
    "Encrypted backups are kept for 90 days on a rolling schedule. A restore request is honoured only within that window.",
  ],
  [
    "6. Deleted workspaces",
    "A deleted workspace is soft-deleted immediately and purged after 45 days. Purge removes workspace content, membership records, and API tokens.",
  ],
  [
    "7. Support tickets",
    "Support conversations are retained for 24 months so that we can answer follow-up questions and keep a consistent history.",
  ],
  ["8. Billing records", "Invoices and payment receipts are retained for 10 years to meet accounting obligations."],
  [
    "9. Sub-processors",
    "A current list of sub-processors is published on the trust page. Customers receive 30 days notice before a new sub-processor starts processing data.",
  ],
  [
    "10. Requests",
    "Data export and deletion requests are acknowledged within 3 business days and completed within 30 days.",
  ],
]

const b1 = page(
  "b1-policy",
  "Data retention policy",
  `<h1>Data retention policy</h1>
<p class="muted">Version 4.2 — effective 1 January 2026. This page is the complete policy.</p>
${policySections.map(([heading, text]) => `<h2>${heading}</h2><p>${text}</p>`).join("")}
<h2>11. Contact</h2><p>Questions about this policy go to the privacy team through the support portal. The privacy team answers within 5 business days.</p>`,
)

const releases = Array.from({ length: 26 }, (_, index) => {
  const minor = 26 - index
  const features = [
    ["Retry jitter for background jobs", "New workspace import wizard", "Faster cold start on Linux"][index % 3],
    ["Improved diff rendering", "Search across archived sessions", "Smaller binary download"][(index + 1) % 3],
  ]
  if (minor === 14) features.unshift("Delta sync between devices")
  return { version: `2.${minor}.0`, features }
})

const b2 = page(
  "b2-changelog",
  "Changelog",
  `<h1>Changelog</h1>
<p class="muted">Every stable release, newest first. Release notes list only user-visible changes.</p>
${releases
  .map(
    (release) => `<h2>${release.version}</h2>
<p class="muted">Released ${release.version.split(".")[1]} months ago</p>
<ul>${release.features.map((feature) => `<li>${feature}</li>`).join("")}</ul>`,
  )
  .join("")}`,
)

const tiers = [
  { name: "Starter", monthly: 9, yearly: 7, seats: "1 seat", note: "Personal projects" },
  { name: "Team", monthly: 29, yearly: 24, seats: "per seat", note: "Shared workspaces, review flows" },
  { name: "Business", monthly: 79, yearly: 65, seats: "per seat", note: "SSO, audit log export, priority support" },
  { name: "Enterprise", monthly: 0, yearly: 0, seats: "annual contract", note: "Custom limits, dedicated support" },
]

const b3 = page(
  "b3-pricing",
  "Pricing",
  `<h1>Pricing</h1>
<p class="muted">Prices in US dollars. Annual billing saves roughly 18%.</p>
<table><thead><tr><th>Plan</th><th>Monthly</th><th>Annual (per month)</th><th>Billing unit</th><th>Notes</th></tr></thead><tbody>
${tiers
  .map(
    (tier) =>
      `<tr><td>${tier.name}</td><td>${
        tier.monthly === 0 ? "custom" : `$${tier.monthly}`
      }</td><td>${tier.yearly === 0 ? "custom" : `$${tier.yearly}`}</td><td>${tier.seats}</td><td>${tier.note}</td></tr>`,
  )
  .join("")}
</tbody></table>
<h2>Included in every paid plan</h2>
<ul><li>Unlimited local sessions</li><li>Browser automation tools</li><li>Usage dashboard and spend limits</li><li>Export of your data at any time</li></ul>
<h2>Add-ons</h2>
<p>Extra concurrency is $12 per parallel session per month. Premium support is $500 per month. Training workshops start at $2,400 per day.</p>
<h2>Discounts</h2>
<p>Non-profits receive 40% off the Team plan. Annual prepayment for more than 50 seats is quoted individually.</p>`,
)

const faqs = [
  [
    "How do I reset my password?",
    "Open the sign-in page and choose Forgot password. The reset link is valid for 30 minutes.",
  ],
  [
    "Can I use the CLI offline?",
    "Yes. Local sessions work offline; synchronization resumes when the connection returns.",
  ],
  ["Which browsers are supported?", "Chrome, Edge, Firefox, and Safari are supported for the web application."],
  [
    "What is the guaranteed first-response time for P1 tickets?",
    "P1 (critical) tickets receive a first response within 1 hour, 24 hours a day.",
  ],
  [
    "What is the guaranteed first-response time for P2 tickets?",
    "P2 (high) tickets receive a first response within 6 hours during business hours.",
  ],
  [
    "What is the guaranteed first-response time for P3 tickets?",
    "P3 (normal) tickets receive a first response within 2 business days.",
  ],
  ["Do you offer a free trial?", "Yes, every workspace starts with a 14-day trial of the Team plan."],
  ["How do I invite a teammate?", "Open workspace settings, choose Members, and send an invite by email."],
  ["Is there an API?", "Yes. The HTTP API is documented on the developers page and uses bearer tokens."],
  ["Where is data stored?", "Workspace content is stored in the region you select when the workspace is created."],
  ["Can I export my data?", "Yes. Workspace settings has an export button that produces a zip archive."],
  ["How do I cancel?", "Open billing settings and choose Cancel plan. Access continues until the period ends."],
  ["Do you support SSO?", "SAML SSO is available on the Business and Enterprise plans."],
  ["What happens when a session ends?", "Ended sessions keep their transcript and become read-only."],
  ["Can I restore a deleted workspace?", "Deleted workspaces can be restored within 45 days by an administrator."],
  ["Which regions are available?", "US East, US West, EU Central, and Asia Pacific."],
  ["How is usage measured?", "Usage is measured in tokens processed and reported in the dashboard."],
  ["Do you have status updates?", "Yes. The status page publishes incidents and maintenance windows."],
  ["Is there a mobile app?", "The web application works on mobile browsers; native apps are on the roadmap."],
  ["How do I contact support?", "Use the support portal or email support from the address listed in your account."],
]

const b4 = page(
  "b4-faq",
  "Frequently asked questions",
  `<h1>Frequently asked questions</h1>
<p class="muted">Answers for administrators and users. Search the page if you cannot find your question.</p>
${faqs.map(([question, answer]) => `<h2>${question}</h2><p>${answer}</p>`).join("")}`,
)

const ledger = Array.from({ length: 80 }, (_, index) => {
  const status = ["paid", "paid", "failed", "paid", "pending", "failed", "paid", "refunded"][index % 8]
  const amount = 10 + ((index * 37) % 90)
  return { id: `LED-${1000 + index}`, status, amount }
})

export const ledgerFailedTotal = ledger
  .filter((row) => row.status === "failed")
  .reduce((sum, row) => sum + row.amount, 0)

const b5 = page(
  "b5-ledger",
  "Ledger",
  `<h1>Ledger</h1>
<p class="muted">All entries for the quarter, ordered by id.</p>
<table><thead><tr><th>Entry</th><th>Status</th><th>Amount</th></tr></thead><tbody>${ledger
    .map((row) => `<tr><td>${row.id}</td><td>${row.status}</td><td>$${row.amount}</td></tr>`)
    .join("")}</tbody></table>`,
)

/* ------------------------------- group C: forms ------------------------------- */

const c1 = page(
  "c1-wizard",
  "Account setup",
  `<h1>Account setup</h1>
<form id="form" novalidate>
<fieldset id="step-one"><legend>Step 1 of 3 — About you</legend>
<label for="name">Full name</label><input id="name" type="text" required>
<label for="email">Work email</label><input id="email" type="text" required>
<p><button type="button" id="next-one">Continue</button></p></fieldset>
<fieldset id="step-two" hidden><legend>Step 2 of 3 — Location</legend>
<label for="city">City</label><input id="city" type="text" required>
<p><button type="button" id="back-two">Back</button> <button type="button" id="next-two">Continue</button></p></fieldset>
<fieldset id="step-three" hidden><legend>Step 3 of 3 — Review</legend>
<p>Name: <strong id="review-name"></strong></p><p>Email: <strong id="review-email"></strong></p>
<p>City: <strong id="review-city"></strong></p>
<p><button type="button" id="back-three">Back</button> <button type="submit" id="submit">Create account</button></p></fieldset>
<p id="error" class="error"></p>
</form>
<p id="status" class="ok"></p>`,
  `const values = { name: "", email: "", city: "" };
const error = document.getElementById("error");
function show(id) {
  ["step-one", "step-two", "step-three"].forEach(function (key) {
    document.getElementById(key).hidden = key !== id;
  });
}
document.getElementById("next-one").addEventListener("click", function () {
  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  if (!name || !email) { error.textContent = "Name and email are required."; return; }
  if (email.indexOf("@") < 1) { error.textContent = "Enter a valid email address."; return; }
  values.name = name; values.email = email; error.textContent = ""; show("step-two");
});
document.getElementById("next-two").addEventListener("click", function () {
  const city = document.getElementById("city").value.trim();
  if (!city) { error.textContent = "City is required."; return; }
  values.city = city; error.textContent = "";
  document.getElementById("review-name").textContent = values.name;
  document.getElementById("review-email").textContent = values.email;
  document.getElementById("review-city").textContent = values.city;
  show("step-three");
});
document.getElementById("back-two").addEventListener("click", function () { show("step-one") });
document.getElementById("back-three").addEventListener("click", function () { show("step-two") });
document.getElementById("form").addEventListener("submit", async function (event) {
  event.preventDefault();
  await record("wizard", { name: values.name, email: values.email, city: values.city });
  document.getElementById("status").textContent = "Account created.";
});`,
)

const c2 = page(
  "c2-email",
  "Newsletter signup",
  `<h1>Newsletter signup</h1>
<form id="form" novalidate>
<label for="email">Email address</label><input id="email" type="text">
<p><button type="submit">Subscribe</button></p>
<p id="error" class="error"></p>
</form>
<p id="status" class="ok"></p>`,
  `document.getElementById("form").addEventListener("submit", async function (event) {
  event.preventDefault();
  const email = document.getElementById("email").value.trim();
  const valid = /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email);
  if (!valid) {
    document.getElementById("error").textContent = "Enter a valid email address, for example name@example.com.";
    await record("invalid", { email: email });
    return;
  }
  document.getElementById("error").textContent = "";
  await record("subscribe", { email: email });
  document.getElementById("status").textContent = "Subscribed.";
});`,
)

const c3 = page(
  "c3-date",
  "Event registration",
  `<h1>Event registration</h1>
<p class="muted">Registrations are open to people born between 1 January 1900 and 1 January 2010.</p>
<form id="form" novalidate>
<label for="name">Attendee name</label><input id="name" type="text">
<label for="birth">Date of birth (YYYY-MM-DD)</label><input id="birth" type="date" min="1900-01-01" max="2010-01-01">
<p><button type="submit">Register</button></p>
<p id="error" class="error"></p>
</form>
<p id="status" class="ok"></p>`,
  `document.getElementById("form").addEventListener("submit", async function (event) {
  event.preventDefault();
  const name = document.getElementById("name").value.trim();
  const birth = document.getElementById("birth").value;
  const invalid = [];
  if (!name) invalid.push("name");
  if (!birth || birth < "1900-01-01" || birth > "2010-01-01") invalid.push("birth");
  if (invalid.length > 0) {
    document.getElementById("error").textContent = "Check these fields: " + invalid.join(", ") + ".";
    await record("invalid", { fields: invalid });
    return;
  }
  document.getElementById("error").textContent = "";
  await record("registration", { name: name, birth: birth });
  document.getElementById("status").textContent = "Registered.";
});`,
)

const c4 = page(
  "c4-code",
  "Team invitation",
  `<h1>Team invitation</h1>
<form id="form" novalidate>
<label for="member">New member email</label><input id="member" type="text">
<label for="code">Access code</label><input id="code" type="text">
<label for="repeat">Repeat access code</label><input id="repeat" type="text">
<p><button type="submit">Send invitation</button></p>
<p id="error" class="error"></p>
</form>
<p id="status" class="ok"></p>`,
  `document.getElementById("form").addEventListener("submit", async function (event) {
  event.preventDefault();
  const member = document.getElementById("member").value.trim();
  const code = document.getElementById("code").value.trim();
  const repeat = document.getElementById("repeat").value.trim();
  const error = document.getElementById("error");
  if (!member || member.indexOf("@") < 1) {
    error.textContent = "Enter a valid member email address.";
    await record("invalid", { fields: ["member"] });
    return;
  }
  if (code.length < 6) {
    error.textContent = "The access code must be at least 6 characters.";
    await record("invalid", { fields: ["code"] });
    return;
  }
  if (code !== repeat) {
    error.textContent = "The access codes do not match.";
    await record("invalid", { fields: ["repeat"] });
    return;
  }
  error.textContent = "";
  await record("invite", { member: member, code: code });
  document.getElementById("status").textContent = "Invitation sent.";
});`,
)

const c5 = page(
  "c5-region",
  "Shipping region",
  `<h1>Shipping region</h1>
<form id="form" novalidate>
<label for="country">Country</label>
<select id="country"><option value="">Choose a country</option><option value="JP">Japan</option><option value="FR">France</option></select>
<label for="city">City</label>
<select id="city" disabled><option value="">Choose a city</option></select>
<p><button type="submit">Continue</button></p>
<p id="error" class="error"></p>
</form>
<p id="status" class="ok"></p>`,
  `const cities = { JP: ["Osaka", "Tokyo"], FR: ["Lyon", "Paris"] };
document.getElementById("country").addEventListener("change", function () {
  const country = document.getElementById("country").value;
  const city = document.getElementById("city");
  city.innerHTML = '<option value="">Choose a city</option>';
  (cities[country] || []).forEach(function (name) {
    const option = document.createElement("option");
    option.value = name; option.textContent = name;
    city.appendChild(option);
  });
  city.disabled = !country;
});
document.getElementById("form").addEventListener("submit", async function (event) {
  event.preventDefault();
  const country = document.getElementById("country").value;
  const city = document.getElementById("city").value;
  if (!country || !city) {
    document.getElementById("error").textContent = "Choose a country and a city.";
    await record("invalid", {});
    return;
  }
  await record("region", { country: country, city: city });
  document.getElementById("status").textContent = "Region saved.";
});`,
)

/* ------------------------------- group D: frames and dialogs ------------------------------- */

const d1 = page(
  "d1-frame-button",
  "Verification panel",
  `<h1>Verification panel</h1>
<p class="muted">The code is revealed inside the panel below.</p>
<iframe src="/t/d1-frame-button/panel" title="Verification panel"></iframe>`,
)

const d1frame = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Panel</title></head>
<body style="font-family:system-ui,sans-serif;padding:1rem">
<p>Press the button to reveal the verification code.</p>
<button id="reveal">Reveal code</button>
<p>Code: <strong id="code">hidden</strong></p>
<script>document.getElementById("reveal").addEventListener("click", function () {
  document.getElementById("code").textContent = "7";
});</script></body></html>`

const d2 = page(
  "d2-alert",
  "Alert gate",
  `<h1>Alert gate</h1>
<p class="muted">Clicking the first button opens a browser alert. Acknowledge it, then submit.</p>
<button id="alert">Show alert</button>
<button id="confirm">Submit acknowledgement</button>
<p id="status" class="ok"></p>`,
  `document.getElementById("alert").addEventListener("click", function () {
  alert("Acknowledgement required before submitting.");
});
document.getElementById("confirm").addEventListener("click", async function () {
  await record("ack", { acknowledged: true });
  document.getElementById("status").textContent = "Acknowledgement recorded.";
});`,
)

const d3 = page(
  "d3-confirm",
  "Saved drafts",
  `<h1>Saved drafts</h1>
<ul id="drafts"><li data-name="Draft 42">Draft 42 <button data-delete="Draft 42">Delete</button></li>
<li data-name="Draft 43">Draft 43 <button data-delete="Draft 43">Delete</button></li></ul>
<p id="status" class="muted"></p>`,
  `document.querySelectorAll("button[data-delete]").forEach(function (button) {
  button.addEventListener("click", async function () {
    const name = button.dataset.delete;
    if (!confirm("Delete " + name + "?")) {
      document.getElementById("status").textContent = "Cancelled.";
      await record("cancel", { name: name });
      return;
    }
    const row = document.querySelector('li[data-name="' + name + '"]');
    if (row) row.remove();
    document.getElementById("status").textContent = name + " deleted.";
    await record("delete", { name: name });
  });
});`,
)

const d4 = page(
  "d4-prompt",
  "Codename",
  `<h1>Codename</h1>
<p>Current codename: <strong id="current">unset</strong></p>
<button id="set">Set codename</button>
<p id="status" class="muted"></p>`,
  `document.getElementById("set").addEventListener("click", async function () {
  const name = prompt("Enter the codename", "");
  if (name === null) {
    document.getElementById("status").textContent = "Cancelled.";
    return;
  }
  document.getElementById("current").textContent = name;
  document.getElementById("status").textContent = "Codename saved.";
  await record("codename", { name: name });
});`,
)

const d5 = page(
  "d5-frame-form",
  "Partner form",
  `<h1>Partner form</h1>
<p class="muted">The form is embedded from the partner service.</p>
<iframe src="/t/d5-frame-form/form" title="Partner form"></iframe>`,
)

const d5frame = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Partner form</title></head>
<body style="font-family:system-ui,sans-serif;padding:1rem">
<h2>Sign up</h2>
<label for="name">Name</label><input id="name" type="text" style="min-width:220px"><br><br>
<label for="email">Email</label><input id="email" type="text" style="min-width:220px"><br><br>
<button id="send">Send</button>
<p id="status" class="ok"></p>
<script>
document.getElementById("send").addEventListener("click", async function () {
  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  await fetch("/__record", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task: "d5-frame-form", kind: "partner", data: { name: name, email: email } })
  });
  document.getElementById("status").textContent = "Sent.";
});
</script></body></html>`

/* ------------------------------- tasks ------------------------------- */

const answer = (value: string) => (outcome: Outcome) =>
  outcome.answer.trim().length > 0 && value === outcome.answer.trim()

const hasRecord = (kind: string) => (outcome: Outcome) => record(outcome, kind) !== undefined

export const TASKS: Task[] = [
  {
    id: "a1-todo",
    group: "app",
    title: "Toggle a checklist item and count the rest",
    instruction:
      'Tick the checkbox for "Write release notes" on this launch checklist. Then check that the open-items counter updated, and reply with the number of items that are still open. End your reply with a line `ANSWER: <number>`.',
    expected: "2",
    check: (outcome) => {
      const entry = record(outcome, "todo")
      return (
        outcome.answer.trim() === "2" &&
        entry !== undefined &&
        Array.isArray(entry.data.done) &&
        entry.data.done.some((name: unknown) => typeof name === "string" && name.includes("Write release notes"))
      )
    },
  },
  {
    id: "a2-cart",
    group: "app",
    title: "Add two products and place the order",
    instruction:
      'Add "Widget Pro" and "Cable Kit" to the cart, confirm the cart shows both items, then place the order and tell me the order total. End your reply with a line `ANSWER: <total in dollars>`.',
    expected: "order with widget-pro and cable-kit, total 61.75",
    check: (outcome) => {
      const entry = record(outcome, "order")
      if (!entry) return false
      const items = entry.data.items
      const total = entry.data.total
      return (
        Array.isArray(items) &&
        items.length === 2 &&
        items.includes("widget-pro") &&
        items.includes("cable-kit") &&
        typeof total === "number" &&
        Math.abs(total - 61.75) < 0.005
      )
    },
  },
  {
    id: "a3-settings",
    group: "app",
    title: "Change two settings and save",
    instruction:
      "Enable dark mode and switch the interface language to Deutsch in this workspace settings page, then save the settings. End your reply with `ANSWER: saved`.",
    expected: "dark=true, language=de",
    check: (outcome) => {
      const entry = record(outcome, "settings")
      return entry !== undefined && entry.data.dark === true && entry.data.language === "de"
    },
  },
  {
    id: "a4-orders",
    group: "app",
    title: "Filter the orders table and find the highest id",
    instruction:
      "Filter this orders table to failed orders only, then look at the visible rows and tell me the highest order id among the failed orders. End your reply with `ANSWER: <order id>`.",
    expected: "ORD-1042 (the prefix may be omitted)",
    check: (outcome) =>
      outcome.answer
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .replace(/^ORD/, "") === "1042",
  },
  {
    id: "a5-basket",
    group: "app",
    title: "Set quantity and label, then add to basket",
    instruction:
      'On this product page set the quantity to 3 and set the order label to "Ada", then add the item to the basket. Confirm the page accepted it. End your reply with `ANSWER: added`.',
    expected: "quantity=3, name=Ada",
    check: (outcome) => {
      const entry = record(outcome, "basket")
      return entry !== undefined && entry.data.quantity === 3 && entry.data.name === "Ada"
    },
  },
  {
    id: "b1-policy",
    group: "content",
    title: "Find the audit-log retention period",
    instruction:
      "Read this data retention policy and tell me how many days audit logs are retained. End your reply with `ANSWER: <number of days>`.",
    expected: "400",
    check: answer("400"),
  },
  {
    id: "b2-changelog",
    group: "content",
    title: "Find the release that introduced delta sync",
    instruction:
      "This changelog lists every release. Which version introduced delta sync? End your reply with `ANSWER: <version>`.",
    expected: "2.14.0",
    check: answer("2.14.0"),
  },
  {
    id: "b3-pricing",
    group: "content",
    title: "Read the annual price of the Team plan",
    instruction:
      "On this pricing page, what is the annual per-month price per seat of the Team plan? End your reply with `ANSWER: <price in dollars, digits only>`.",
    expected: "24",
    check: answer("24"),
  },
  {
    id: "b4-faq",
    group: "content",
    title: "Find the P2 first-response time",
    instruction:
      "Read this FAQ and tell me the guaranteed first-response time, in hours, for P2 tickets. End your reply with `ANSWER: <number of hours>`.",
    expected: "6",
    check: answer("6"),
  },
  {
    id: "b5-ledger",
    group: "content",
    title: "Total the failed ledger entries",
    instruction:
      "This ledger has 80 entries. Add up the amount column for every entry whose status is failed, and reply with that total. End your reply with `ANSWER: <total in dollars, digits only>`.",
    expected: String(ledgerFailedTotal),
    check: (outcome) => outcome.answer.trim() === String(ledgerFailedTotal),
  },
  {
    id: "c1-wizard",
    group: "form",
    title: "Complete a three-step wizard",
    instruction:
      'Create an account through this three-step wizard: name "Grace Hopper", email "grace@example.com", city "Arlington". Submit the form once every step is filled in. End your reply with `ANSWER: created`.',
    expected: "Grace Hopper / grace@example.com / Arlington",
    check: (outcome) => {
      const entry = record(outcome, "wizard")
      return (
        entry !== undefined &&
        entry.data.name === "Grace Hopper" &&
        entry.data.email === "grace@example.com" &&
        entry.data.city === "Arlington"
      )
    },
  },
  {
    id: "c2-email",
    group: "form",
    title: "Submit an invalid email, correct it, submit again",
    instruction:
      'Subscribe to the newsletter. First submit the address "ada@example" and observe the validation error, then correct it to "ada@example.com" and submit successfully. End your reply with `ANSWER: subscribed`.',
    expected: "invalid attempt recorded, then ada@example.com",
    check: (outcome) =>
      hasRecord("subscribe")(outcome) &&
      record(outcome, "subscribe")?.data.email === "ada@example.com" &&
      hasRecord("invalid")(outcome),
  },
  {
    id: "c3-date",
    group: "form",
    title: "Correct a rejected date of birth",
    instruction:
      'Register for the event with the name "Katherine Johnson". Your first attempt uses the date of birth 2015-06-01, which the page rejects; then try 2001-03-04 and submit successfully. End your reply with `ANSWER: registered`.',
    expected: "invalid attempt recorded, then birth=2001-03-04",
    check: (outcome) =>
      hasRecord("invalid")(outcome) &&
      record(outcome, "registration")?.data.birth === "2001-03-04" &&
      record(outcome, "registration")?.data.name === "Katherine Johnson",
  },
  {
    id: "c4-code",
    group: "form",
    title: "Fix a mismatched access code",
    instruction:
      'Send an invitation to "new.member@example.com". Your first attempt uses access code "orbit-42" with repeat "orbit-24", which the page rejects because they do not match; then enter "orbit-42" in both fields and send it. End your reply with `ANSWER: sent`.',
    expected: "mismatch error recorded, then code=orbit-42",
    check: (outcome) => hasRecord("invalid")(outcome) && record(outcome, "invite")?.data.code === "orbit-42",
  },
  {
    id: "c5-region",
    group: "form",
    title: "Use dependent selects",
    instruction:
      "Set the shipping region to country Japan and city Osaka in this form, then continue. The city list only fills in after you pick the country. End your reply with `ANSWER: saved`.",
    expected: "country=JP, city=Osaka",
    check: (outcome) => {
      const entry = record(outcome, "region")
      return entry !== undefined && entry.data.country === "JP" && entry.data.city === "Osaka"
    },
  },
  {
    id: "d1-frame-button",
    group: "frames",
    title: "Click a button inside an iframe",
    instruction:
      "The verification code is inside the panel embedded in this page. Click the button inside the panel to reveal it and tell me the code. End your reply with `ANSWER: <code>`.",
    expected: "7",
    check: answer("7"),
  },
  {
    id: "d2-alert",
    group: "frames",
    title: "Acknowledge an alert dialog, then submit",
    instruction:
      'Click "Show alert" and acknowledge the browser alert, then submit the acknowledgement. End your reply with `ANSWER: acked`.',
    expected: "acknowledged=true",
    check: (outcome) => record(outcome, "ack")?.data.acknowledged === true,
  },
  {
    id: "d3-confirm",
    group: "frames",
    title: "Accept a delete confirmation",
    instruction:
      'Delete the saved draft named "Draft 42" from this page. The page asks for confirmation before deleting; accept it. End your reply with `ANSWER: deleted`.',
    expected: "deleted Draft 42",
    check: (outcome) => record(outcome, "delete")?.data.name === "Draft 42",
  },
  {
    id: "d4-prompt",
    group: "frames",
    title: "Answer a prompt dialog",
    instruction:
      'Use the page button to set the codename to "orbit-42" and confirm the page shows the new codename. End your reply with `ANSWER: orbit-42`.',
    expected: "codename=orbit-42",
    check: (outcome) => record(outcome, "codename")?.data.name === "orbit-42",
  },
  {
    id: "d5-frame-form",
    group: "frames",
    title: "Submit a form inside an iframe",
    instruction:
      'Fill in the partner form embedded in this page with name "Ada Lovelace" and email "ada@example.com", then send it. End your reply with `ANSWER: sent`.',
    expected: "Ada Lovelace / ada@example.com",
    check: (outcome) => {
      const entry = record(outcome, "partner")
      return entry !== undefined && entry.data.name === "Ada Lovelace" && entry.data.email === "ada@example.com"
    },
  },
]

export const PAGES: Record<string, string> = {
  "a1-todo": a1,
  "a2-cart": a2,
  "a3-settings": a3,
  "a4-orders": a4,
  "a5-basket": a5,
  "b1-policy": b1,
  "b2-changelog": b2,
  "b3-pricing": b3,
  "b4-faq": b4,
  "b5-ledger": b5,
  "c1-wizard": c1,
  "c2-email": c2,
  "c3-date": c3,
  "c4-code": c4,
  "c5-region": c5,
  "d1-frame-button": d1,
  "d2-alert": d2,
  "d3-confirm": d3,
  "d4-prompt": d4,
  "d5-frame-form": d5,
}

export const FRAMES: Record<string, string> = {
  "d1-frame-button": d1frame,
  "d5-frame-form": d5frame,
}

export function task(id: string): Task {
  const found = TASKS.find((item) => item.id === id)
  if (!found) throw new Error(`unknown task: ${id}`)
  return found
}

/** Extracts the answer after the last `ANSWER:` marker; empty when the run did not follow the format. */
export function answerOf(text: string): string {
  const matches = [...text.matchAll(/ANSWER:\s*(.+)/gi)]
  const last = matches.at(-1)?.at(1)
  return (last ?? "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.]+$/, "")
    .trim()
}
