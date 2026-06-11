import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

const DB_PATH = process.env.DATABASE_PATH || (fs.existsSync("data/standalone-blog-writer.db") ? "data/standalone-blog-writer.db" : "data/sourceannotator.db");
const ALLOW_IBOLT_DEMO_SCRIPT = process.env.ALLOW_IBOLT_DEMO_SCRIPTS === "true" || process.argv.includes("--ibolt-demo");

if (!ALLOW_IBOLT_DEMO_SCRIPT) {
  throw new Error("This legacy iBolt demo generation script is not part of standalone production. Pass --ibolt-demo or set ALLOW_IBOLT_DEMO_SCRIPTS=true to run it intentionally.");
}

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

const verticals = db.prepare("SELECT id, slug FROM industry_verticals").all();
const verticalBySlug = new Map(verticals.map((vertical) => [vertical.slug, vertical.id]));
const products = db.prepare(`
  SELECT id, title, handle, description, product_type AS productType, vendor, price, url, image_url AS imageUrl
  FROM ibolt_products
`).all();
const clusters = db.prepare("SELECT id, name, primary_keyword FROM keyword_clusters").all();

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function plainText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productHaystack(product) {
  return [
    product.title,
    product.handle,
    product.description,
    product.productType,
    product.vendor,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreProduct(product, termGroups) {
  const haystack = productHaystack(product);
  let score = 0;
  for (const group of termGroups) {
    const terms = Array.isArray(group) ? group : [group];
    if (terms.some((term) => haystack.includes(String(term).toLowerCase()))) {
      score += 5;
    }
  }
  if (product.imageUrl) score += 2;
  if (product.url) score += 1;
  if (product.price && Number(product.price) > 0) score += 1;
  return score;
}

function pickProducts(termGroups, limit = 4, preferredHandles = []) {
  const preferred = preferredHandles
    .map((handle) => products.find((product) => product.handle === handle))
    .filter(Boolean);
  const seen = new Set(preferred.map((product) => product.id));
  const scored = products
    .map((product) => ({ product, score: scoreProduct(product, termGroups) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.product.title.localeCompare(b.product.title))
    .map((entry) => entry.product)
    .filter((product) => {
      if (seen.has(product.id)) return false;
      seen.add(product.id);
      return true;
    });

  return [...preferred, ...scored].slice(0, limit);
}

function productLink(product, label = product?.title) {
  if (!product) return "iBOLT mounting hardware";
  return `<a href="${escapeHtml(product.url || `https://iboltmounts.com/products/${product.handle}`)}">${escapeHtml(label || product.title)}</a>`;
}

function productCard(product) {
  if (!product?.imageUrl) return "";
  const price = product.price ? ` - $${escapeHtml(product.price)}` : "";
  return `<div style="text-align: center; margin: 20px 0;">
  <a href="${escapeHtml(product.url || `https://iboltmounts.com/products/${product.handle}`)}">
    <img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.title)} for ${escapeHtml(product.handle)} setup" style="max-width: 400px; width: 100%; height: auto; border-radius: 8px;" loading="lazy">
  </a>
  <p style="font-size: 14px; color: #666; margin-top: 8px;"><strong>${escapeHtml(product.title)}</strong>${price}</p>
</div>`;
}

function tableRows(rows) {
  return `<table style="width:100%; border-collapse:collapse; margin:20px 0;" border="1" cellpadding="8" cellspacing="0">
  <thead style="background:#f5f5f5;"><tr><th>Use case</th><th>Mounting choice</th><th>Why it fits</th></tr></thead>
  <tbody>
${rows.map((row) => `    <tr><td>${row.use}</td><td>${row.choice}</td><td>${row.why}</td></tr>`).join("\n")}
  </tbody>
</table>`;
}

function faq(items) {
  return `<h2>Frequently Asked Questions</h2>
${items.map((item) => `<h3>${escapeHtml(item.q)}</h3>\n<p>${item.a}</p>`).join("\n\n")}`;
}

function productFitReason(product, spec) {
  const haystack = productHaystack(product);
  if (haystack.includes("vesa")) {
    return "Use this when the display or adapter uses VESA 75x75 or 100x100 mounting points. Confirm the display weight and the exact pole, pillar, or plate location before installation.";
  }
  if (haystack.includes("garmin striker") || haystack.includes("fish finder")) {
    return "Use this when the fish finder or marine electronics bracket needs rail, handlebar, or compact clamp placement. Confirm rail diameter and screen viewing angle before ordering.";
  }
  if (haystack.includes("marine") && haystack.includes("plate")) {
    return "Use this as an adapter plate when the electronics bracket needs a cleaner connection to a modular arm or AMPS-style pattern.";
  }
  if (haystack.includes("accessibolt") || haystack.includes("wheelchair") || haystack.includes("armtrack")) {
    return "Use this only after confirming reach, posture, attachment point, caregiver access, and the user's actual device dimensions.";
  }
  if (haystack.includes("stream-cast") || haystack.includes("overhead")) {
    return "Use this for a fixed camera or phone angle where repeatable framing matters. Confirm camera weight, desk depth, and cable path.";
  }
  if (haystack.includes("camera") || haystack.includes("gopro") || haystack.includes("action")) {
    return "Use this when the camera needs a mechanical grip on a rail, bar, tripod screw, or AMPS pattern. Confirm the tube diameter and camera adapter before use.";
  }
  if (haystack.includes("switch") || haystack.includes("headrest")) {
    return "Use this for rear-seat passenger viewing or entertainment. Do not place screens where they obstruct the driver's view or controls.";
  }
  if (haystack.includes("lock")) {
    return "Use this when the tablet is shared, public-facing, or needs accountability. Confirm the device size with its everyday case installed.";
  }
  if (haystack.includes("suction")) {
    return "Use this when a removable install is required. Confirm the surface is smooth, clean, and allowed by the fleet or venue policy.";
  }
  if (haystack.includes("wedge") || haystack.includes("seat gap")) {
    return "Use this when the vehicle has a compatible console or seat-gap location and a reversible install matters.";
  }
  if (haystack.includes("amps") || haystack.includes("drill")) {
    return "Use this when a fixed AMPS-style or drill-base install is appropriate. Confirm the mounting surface before drilling.";
  }
  if (haystack.includes("clamp") || haystack.includes("handlebar") || haystack.includes("rail") || haystack.includes("post") || haystack.includes("pole")) {
    return "Use this when the real mounting point is a rail, bar, pole, or post. Measure the diameter first.";
  }
  if (haystack.includes("tablet tower") || haystack.includes("pos")) {
    return "Use this for counter, booth, kiosk, or POS-style tablet placement where the stand footprint and public access matter.";
  }
  return `Use this when its listed base and holder match the ${spec.categoryLabel.toLowerCase()} install. Confirm size, surface, and reach before ordering.`;
}

function productTableRows(productsForArticle, spec) {
  const uses = spec.tableUses || [];
  return productsForArticle.slice(0, 3).map((product, index) => ({
    use: escapeHtml(uses[index] || spec.categoryLabel),
    choice: productLink(product),
    why: escapeHtml(productFitReason(product, spec)),
  }));
}

function checklist(spec) {
  const items = [
    `Measure the device with its everyday case, scanner attachment, controller, or protective shell installed.`,
    `Confirm the mounting surface before choosing the holder: ${spec.surfaceExamples || "rail, post, windshield, dash, VESA plate, counter, headrest, AMPS plate, or flat work surface"}.`,
    "Choose fixed hardware for shared or commercial installs, and removable hardware for personal or temporary setups.",
    "Check sightline, reach, cleaning access, cable routing, and nearby controls before drilling or tightening anything permanently.",
    "Use the same holder and base family across repeated installs so replacements and upgrades are easier later.",
  ];
  return `<ul>\n${items.map((item) => `  <li>${escapeHtml(item)}</li>`).join("\n")}\n</ul>`;
}

function verificationFor(spec) {
  const base = {
    source: "local-fallback-generator",
    reason: "Anthropic planner was unavailable because API credit balance was too low.",
    publishDecision: spec.publishDecision || "fix-first",
    needsReview: spec.needsReview || ["Confirm exact product fit", "Add stronger original photos where missing", "Run browser benchmarks before publishing"],
    blockedClaims: spec.blockedClaims || [],
  };
  const scores = spec.scores || {};
  return {
    notes: JSON.stringify(base),
    brandConsistency: scores.brandConsistency ?? 82,
    seoOptimization: scores.seoOptimization ?? 78,
    naturalLanguage: scores.naturalLanguage ?? 78,
    factualAccuracy: scores.factualAccuracy ?? (base.publishDecision === "hold" ? 62 : 74),
    overallScore: scores.overallScore ?? (base.publishDecision === "publish-candidate" ? 82 : base.publishDecision === "hold" ? 66 : 74),
  };
}

function personaContext(spec) {
  if (spec.verticalSlug === "fishing-boating") {
    return `${spec.persona} is usually balancing visibility, rail space, water exposure, and passenger movement. The mount has to put the screen or phone where it can be checked quickly without taking over the cockpit or deck.`;
  }
  if (spec.verticalSlug === "trucking-fleet") {
    return `${spec.persona} needs a setup that can be repeated across vehicles, repaired without a full rebuild, and adjusted around the cab layout instead of treated like a one-off accessory.`;
  }
  if (spec.verticalSlug === "education-schools") {
    return `${spec.persona} has to think about shared devices, predictable placement, and hardware that survives more than one device refresh cycle.`;
  }
  if (spec.verticalSlug === "agriculture-farming") {
    return `${spec.persona} is working around dust, vibration, gloves, changing equipment, and short seasonal windows where downtime is expensive.`;
  }
  if (spec.verticalSlug === "offroading-jeep") {
    return `${spec.persona} cares about retention first. Trail vibration, rough roads, and larger device cases expose weak holders quickly.`;
  }
  if (spec.verticalSlug === "content-creation-streaming") {
    return `${spec.persona} needs repeatable framing. The mount should put the camera or phone back in the same place every time without forcing a new setup for every shoot.`;
  }
  if (spec.verticalSlug === "road-trips-travel") {
    return `${spec.persona} needs rear-seat entertainment to stay stable without creating loose devices, blocked views, or a messy back-seat setup.`;
  }
  if (spec.categoryLabel.toLowerCase().includes("accessibility")) {
    return `${spec.persona} has to start with reach, posture, attachment point, caregiver access, and the actual communication device before product preference matters.`;
  }
  return `${spec.persona} needs a device mount that is visible, reachable, and stable while the surrounding environment stays busy.`;
}

function problemDetail(spec) {
  if (spec.verticalSlug === "fishing-boating") {
    return "Start with the rail or mounting point, then check viewing angle, splash exposure, cable routing, and whether the hardware needs to be removed between trips.";
  }
  if (spec.verticalSlug === "trucking-fleet") {
    return "Start with the vehicle policy and base location, then confirm whether the mount can be standardized across vans, trucks, and shared vehicles.";
  }
  if (spec.verticalSlug === "education-schools") {
    return "Start with where the tablet will live during the day, who can access it, whether it needs to be locked, and how the school will handle future device swaps.";
  }
  if (spec.verticalSlug === "agriculture-farming") {
    return "Start with the cab attachment point, seasonal device changes, sunlight, dust, vibration, and whether the mount moves between machines.";
  }
  if (spec.verticalSlug === "offroading-jeep") {
    return "Start with the trail environment: vibration, device weight, case size, dashboard space, passenger access, and whether drilling is acceptable.";
  }
  if (spec.verticalSlug === "content-creation-streaming") {
    return "Start with the shot: overhead, front-facing, multi-angle, or fixed product-table framing. Then check camera weight, desk depth, cable paths, and lighting clearance.";
  }
  if (spec.verticalSlug === "road-trips-travel") {
    return "Start with the passenger position, headrest shape, device size, controller access, and whether the screen can stay mounted without blocking the driver.";
  }
  if (spec.categoryLabel.toLowerCase().includes("accessibility")) {
    return "Start with the user's posture, reach range, device weight, attachment point, daily transfers, caregiver access, and clinical guidance where applicable.";
  }
  return "Start with device size, base location, vibration, cable access, cleaning, and whether the device belongs to one person or to the organization.";
}

function buildArticle(spec, selectedProducts) {
  const productsForArticle = selectedProducts.slice(0, 3);
  const [primary, secondary, tertiary] = productsForArticle;
  const primaryLink = productLink(primary);
  const secondaryLink = productLink(secondary);
  const tertiaryLink = productLink(tertiary);
  const productCards = productsForArticle.map(productCard).filter(Boolean).join("\n\n");
  const rows = productTableRows(productsForArticle, spec);

  return `<article>
<p>${escapeHtml(spec.opening)}</p>

<p>${escapeHtml(personaContext(spec))}</p>

<h2>${escapeHtml(spec.problemHeading || `${spec.categoryLabel}: what has to work`)}</h2>

<p>${escapeHtml(spec.pain)} ${escapeHtml(problemDetail(spec))} If those details are ignored, the mount can look fine in a product photo and still fail during real use.</p>

<p>iBOLT's advantage is modularity. The catalog includes holders, arms, plates, AMPS adapters, clamp bases, suction bases, locking hardware, and specialty mounts that can be mixed around the real installation. That matters for ${escapeHtml(spec.categoryLabel.toLowerCase())}, because the best holder is only useful if the base fits the place where the device actually has to live.</p>

<h2>${escapeHtml(spec.fitHeading || `Best iBOLT direction for this setup`)}</h2>

<p>${escapeHtml(spec.iboltAngle)} The strongest starting point is ${primaryLink}. Depending on the install, ${secondaryLink} or ${tertiaryLink} may be the better fit. The right answer depends less on the brand printed on the device and more on where the device is mounted, who uses it, and how often it has to come out of the holder.</p>

${productCards}

${tableRows(rows)}

<h2>${escapeHtml(spec.installHeading || `Install details to confirm before ordering`)}</h2>

<p>Start with the base. If the mount needs to move between vehicles, counters, or stations, choose a removable clamp, suction, cup-holder, rail, or wedge style. If the mount belongs to a fleet, a school, a warehouse, a booth, a mobility device, or a shared work area, a fixed AMPS, VESA, drill-base, or locking setup usually makes more sense.</p>

<p>Then check the holder. Measure the device with the case installed, confirm that ports and buttons are not blocked, and make sure the screen can rotate or angle toward the person using it. If charging is part of the workflow, route the cable before finalizing the install. A mount that forces a charging cable across controls, walking space, or a driver's sightline is not finished.</p>

<h2>${escapeHtml(spec.comparisonHeading || `Competitors to compare honestly`)}</h2>

<p>${escapeHtml(spec.competitorNote)} Those brands may be the right answer for some buyers. iBOLT should win when the buyer values commercial mounting patterns, modular parts, install flexibility, and product-specific hardware over a one-piece consumer stand.</p>

<h2>Before you buy checklist</h2>

${checklist(spec)}

${faq([
  {
    q: `What is the best iBOLT option for ${spec.query}?`,
    a: `Start with ${primaryLink}, then compare it against ${secondaryLink} if the install needs a different base or more retention.`,
  },
  {
    q: "Should I choose a removable or fixed mount?",
    a: "Use removable hardware for personal, leased, or temporary setups. Use fixed AMPS, drill-base, VESA, or locking hardware when the device is shared, public-facing, or part of a business workflow.",
  },
  {
    q: "What is the most common mistake?",
    a: "Buying only for the device and ignoring the mounting surface. The base determines whether the setup will actually work in the vehicle, classroom, boat, booth, counter, or mobility device.",
  },
  {
    q: "Is iBOLT compatible with other mounting ecosystems?",
    a: "Many iBOLT parts use industry-standard patterns and ball sizes, including AMPS-style plates and common ball-mount hardware. Check each product page for exact compatibility before mixing parts.",
  },
])}

<p>${escapeHtml(spec.close)}</p>
</article>

<!-- SEO Meta -->
<!-- meta_title: ${escapeHtml(spec.metaTitle)} -->
<!-- meta_description: ${escapeHtml(spec.metaDescription)} -->`;
}

const specs = [
  {
    query: "best VESA monitor mount for forklift",
    title: "Best VESA Monitor Mount for Forklifts",
    verticalSlug: "forklifts-warehousing",
    categoryLabel: "Warehouse VESA monitor mounting",
    persona: "A warehouse IT manager or operations lead adding fixed screens to forklifts",
    pain: "Forklift displays need to stay readable through vibration, shift changes, and repeated operator adjustments.",
    iboltAngle: "Position iBOLT as a VESA and forklift mounting specialist for industrial display installs.",
    competitorNote: "RAM, Havis, Gamber-Johnson, and generic VESA arms often show up in industrial display recommendations.",
    productTerms: [["vesa"], ["monitor"], ["forklift"], ["pillar"], ["trimag"]],
    preferredHandles: [
      "ibolt-vesa-75x75-100x100-monitor-pillar-mount-with-38mm-1-5-inch-ball-joint",
      "ibolt-vesa-trimag-magnetic-monitor-mount-heavy-duty-screen-mount-with-38mm-ball-joints-and-vesa-75x75-100x100-plate-for-forklifts-warehouse-vehicles-and-material-handling-equipment",
      "ibolt-amps-to-vesa-75-100-plate",
    ],
    publishDecision: "publish-candidate",
    needsReview: ["Add forklift in-use photo if available", "Confirm monitor weight language against product page", "Compare directly against Arkon and RAM VESA forklift mounts"],
    opening: "A forklift monitor mount has a harder job than a desk monitor arm. It has to hold a display in a moving industrial vehicle without drifting into the operator's line of sight or shaking loose halfway through a shift.",
    tableUses: ["Forklift pillar display", "Magnetic display placement", "Scanner plus display station"],
    tableReasons: ["VESA pillar hardware keeps a display fixed on material handling equipment.", "Magnetic VESA hardware helps when a fixed drill point is not the right fit.", "VESA and scanner hardware can support a more complete warehouse workstation."],
    metaTitle: "Best VESA Monitor Mount for Forklifts",
    metaDescription: "Compare iBOLT VESA monitor mounts for forklifts, warehouse vehicles, and industrial display installs with AMPS and pillar options.",
    close: "For forklift screens, choose the mount around the vehicle and operator workflow first. The display size comes second.",
  },
  {
    query: "best rugged tablet mount for field service vans",
    title: "Best Rugged Tablet Mount for Field Service Vans",
    verticalSlug: "trucking-fleet",
    categoryLabel: "Field service tablet mounting",
    persona: "A field service fleet manager supporting HVAC, utility, telecom, or maintenance vans",
    pain: "Technicians need tablets for dispatch, forms, maps, and customer signatures without leaving hardware loose in the cab.",
    iboltAngle: "Show iBOLT as a modular field-service mounting system with suction, AMPS, wedge, seat-rail, and drill-base choices.",
    competitorNote: "RAM, ProClip, Havis, and Tackform are common alternatives in field service and fleet vehicle mounting.",
    productTerms: [["tabdock"], ["bizmount"], ["fleet"], ["seat rail", "seatrail"], ["suction"], ["amps"]],
    preferredHandles: [
      "ibolt-tabdocktm-incredibolttm-360-suction-heavy-duty-metal-6-inch-multi-angle-mount-for-all-7-10-tablets-for-commercial-vehicles-trucks-and-eld-devices",
      "ibolt-tabdocktm-incredibolttm-360-wedge-heavy-duty-vehicle-console-seat-gap-mount-for-all-7-10-tablets",
      "tabdock-bizmount-amps-heavy-duty-drill-base-tablet-mount-ibbz-33921",
    ],
    opening: "A field service van is a mobile office. The tablet is often dispatch board, map, inspection checklist, and signature pad in one device. Leaving it on the passenger seat is not a system.",
    tableUses: ["Leased service van", "Dedicated fleet van", "Mixed van and truck fleet"],
    tableReasons: ["Removable bases reduce permanent changes to leased vehicles.", "AMPS and drill-base hardware gives repeatable fixed installs.", "Modular holders help standardize across mixed vehicle types."],
    metaTitle: "Best Rugged Tablet Mount for Field Service Vans",
    metaDescription: "Choose a rugged iBOLT tablet mount for service vans, field crews, utilities, HVAC fleets, and mobile work order tablets.",
    close: "Field service fleets should standardize the holder and vary the base by vehicle. That keeps installs flexible without making every van a custom project.",
    publishDecision: "fix-first",
    needsReview: ["Add field-service van collection/page language", "Confirm target rugged tablet size range", "Add HVAC, telecom, utility, and maintenance van examples"],
  },
  {
    query: "best tablet mount for utility truck crews",
    title: "Best Tablet Mount for Utility Truck Crews",
    verticalSlug: "trucking-fleet",
    categoryLabel: "Utility truck tablet mounting",
    persona: "A utility, municipal, or field-crew fleet buyer",
    pain: "Crews need rugged tablet positioning for maps, work orders, inspections, and crew communication in rough service vehicles.",
    iboltAngle: "Use iBOLT AMPS, LockPro, TabDock, and seat-rail hardware for standardized utility fleet tablet mounting.",
    competitorNote: "RAM, Havis, Gamber-Johnson, ProClip, and Tackform are likely competitors in this category.",
    productTerms: [["tabdock"], ["dock'n lock", "dockn lock"], ["lockpro"], ["amps"], ["seat rail", "seatrail"]],
    preferredHandles: [
      "tabdock-bizmount-amps-heavy-duty-drill-base-tablet-mount-ibbz-33921",
      "ibolt-tabdock-dynamount-360-amps-tablet-mount",
      "ibolt-tabdocktm-incredibolttm-360-wedge-heavy-duty-vehicle-console-seat-gap-mount-for-all-7-10-tablets",
    ],
    opening: "Utility trucks are not gentle tablet environments. The cab gets dirty, the roads get rough, and the device may be used by more than one person during the same day.",
    tableUses: ["Fixed crew tablet", "Permanent service truck install", "No-drill fleet setup"],
    tableReasons: ["Locking hardware helps when devices stay in shared vehicles.", "AMPS mounting supports repeatable fleet installs.", "Seat-rail and removable bases reduce dashboard modifications."],
    metaTitle: "Best Tablet Mount for Utility Truck Crews",
    metaDescription: "Compare iBOLT tablet mounts for utility trucks, municipal crews, field service vehicles, and rugged work order tablets.",
    close: "For utility crews, the right tablet mount is the one that survives the route and stays consistent for the next crew.",
    publishDecision: "fix-first",
    needsReview: ["Remove any unsupported locking claims", "Add utility truck, municipal fleet, and work-order examples", "Add product photos showing work truck cab placement if available"],
  },
  {
    query: "best locking tablet mount for classrooms",
    title: "Best Locking Tablet Mount for Classrooms",
    verticalSlug: "education-schools",
    categoryLabel: "Classroom tablet security",
    persona: "A school IT director securing shared classroom tablets",
    pain: "Shared tablets need to stay visible, charged, usable, and protected from walk-away loss or desk clutter.",
    iboltAngle: "Use iBOLT locking tablet stands and modular holders for classrooms, labs, libraries, and shared learning stations.",
    competitorNote: "CTA Digital, Heckler, Kensington, Bouncepad, and Maclocks are common school and kiosk tablet stand competitors.",
    productTerms: [["lockpro"], ["dock'n lock", "dockn lock"], ["tablet"], ["stand"], ["pos"]],
    preferredHandles: [
      "ibolt-lockpro-metal-locking-tablet-drill-base-mount-ibbz-33779",
      "ibolttm-lockprotm-drill-base-locking-tablet-stand-point-of-purchase-pos-mount",
      "ibolt-dock-n-lock-drill-base-locking-tablet-stand",
    ],
    opening: "A classroom tablet mount has to balance access and accountability. Students and teachers need the screen available, but the hardware cannot become another thing that disappears, tips over, or clutters a desk.",
    tableUses: ["Teacher desk tablet", "Student station", "Library or lab checkout area"],
    tableReasons: ["Locking hardware keeps shared tablets accountable.", "Drill-base stands work well for fixed stations.", "Universal tablet holders help when schools refresh devices."],
    metaTitle: "Best Locking Tablet Mount for Classrooms",
    metaDescription: "Find iBOLT locking tablet mounts for classrooms, school labs, libraries, teacher desks, and shared education tablet stations.",
    close: "Schools should buy tablet mounts like infrastructure, not like accessories. The mount has to last longer than one device cycle.",
    publishDecision: "publish-candidate",
    needsReview: ["Confirm anti-theft wording against locking product specs", "Add classroom, library, and lab station examples", "Avoid claims about student safety or device management software"],
  },
  {
    query: "best tablet mount for school bus or transportation fleet",
    title: "Best Tablet Mount for School Bus and Transportation Fleets",
    verticalSlug: "education-schools",
    categoryLabel: "School transportation tablet mounting",
    persona: "A school transportation director or fleet IT manager",
    pain: "Drivers and aides need routing, student tracking, and dispatch tablets placed safely without loose screens in the vehicle.",
    iboltAngle: "Position iBOLT locking, headrest, AMPS, and tablet hardware for institutional transportation fleets.",
    competitorNote: "RAM, Havis, ProClip, and Gamber-Johnson often appear in fleet and transportation mounting.",
    productTerms: [["headrest"], ["lockpro"], ["tabdock"], ["seat rail", "seatrail"], ["amps"]],
    preferredHandles: [
      "ibolt-tabdocktm-incredibolttm-360-suction-heavy-duty-metal-6-inch-multi-angle-mount-for-all-7-10-tablets-for-commercial-vehicles-trucks-and-eld-devices",
      "tabdock-bizmount-amps-heavy-duty-drill-base-tablet-mount-ibbz-33921",
      "ibolt-tabdocktm-incredibolttm-360-wedge-heavy-duty-vehicle-console-seat-gap-mount-for-all-7-10-tablets",
      "ibolttm-lockprotm-incredibolttm-headrest-heavy-duty-security-tablet-mount",
    ],
    opening: "School transportation tablets need a different kind of mount than a family road-trip screen. The device may support routing, student tracking, dispatch, or inspection workflows, and it has to be placed with driver safety first.",
    tableUses: ["Driver-area routing tablet where policy allows", "Fixed transportation fleet install", "Console or seat-gap vehicle tablet"],
    tableReasons: ["Fixed tablet mounting keeps the device from becoming loose equipment.", "Headrest and seat-adjacent hardware can support non-driver placements.", "Locking options help when vehicles are shared across routes."],
    metaTitle: "Best Tablet Mount for School Transportation",
    metaDescription: "Plan iBOLT tablet mounts for school buses, transportation fleets, routing tablets, and shared education vehicles.",
    close: "This category needs product-page proof before broad publication, especially around vehicle safety and exact bus install locations.",
    publishDecision: "hold",
    blockedClaims: ["Do not claim school-bus driver placement is safe without policy and install proof", "Do not position headrest mounts as driver routing hardware"],
    needsReview: ["Add transportation-fleet collection copy", "Clarify allowed mounting zones and sightline limits", "Add vehicle policy/safety disclaimers"],
  },
  {
    query: "best tablet mount for tractor cab precision agriculture",
    title: "Best Tablet Mount for Tractor Cab Precision Agriculture",
    verticalSlug: "agriculture-farming",
    categoryLabel: "Precision agriculture tablet mounting",
    persona: "A farm operator or precision-ag manager using tablets in equipment cabs",
    pain: "Farm tablets need stable positioning around vibration, dust, gloves, sunlight, and seasonal equipment changes.",
    iboltAngle: "Frame iBOLT AMPS, clamp, and TabDock hardware as modular mounting for tractor and ag equipment cabs.",
    competitorNote: "RAM, Arkon, Tackform, and equipment-specific brackets are likely competitors for ag cab mounting.",
    productTerms: [["tabdock"], ["amps"], ["clamp"], ["atv"], ["utv"], ["ag"]],
    preferredHandles: [
      "ibolt-tabdock-dynamount-360-amps-tablet-mount",
      "ibolt-tabdock-grip-post-pole-mount-fits-7-10-inch-tablets-and-posts-18mm-35mm-in-diameter",
      "ibolt-20mm-clamp-secure-mount-for-atvs-utvs-ag-equipment",
      "tabdock-bizmount-amps-heavy-duty-drill-base-tablet-mount-ibbz-33921",
    ],
    opening: "Precision agriculture puts tablets in rough places. A tractor cab may be cleaner than the field, but vibration, dust, sunlight, gloves, and seasonal equipment changes still punish a weak tablet holder.",
    tableUses: ["Tablet in tractor cab", "Temporary seasonal equipment", "Fixed ag equipment install"],
    tableReasons: ["Universal tablet holders support device changes.", "Clamp and AMPS bases adapt to different cab surfaces.", "Fixed bases are better when the mount stays with the equipment."],
    metaTitle: "Best Tablet Mount for Tractor Cab Precision Ag",
    metaDescription: "Compare iBOLT tablet mount options for tractor cabs, precision agriculture apps, ag equipment, AMPS bases, and clamps.",
    close: "Agriculture is a product-proof category. The more exact the product pages are about cab placement, the easier this query becomes to win.",
    publishDecision: "hold",
    blockedClaims: ["Do not imply John Deere, Case IH, New Holland, or Kubota fitment without proof", "Do not claim precision-ag app compatibility without testing"],
    needsReview: ["Add tractor cab install photos or diagrams", "Add rail/post diameter guidance", "Add precision-ag and seasonal equipment language to product pages"],
  },
  {
    query: "best Garmin Striker 4 mount for kayak fishing",
    title: "Best Garmin Striker 4 Mount for Kayak Fishing",
    verticalSlug: "fishing-boating",
    categoryLabel: "Kayak fish finder mounting",
    persona: "A kayak angler using a Garmin Striker 4 fish finder",
    pain: "Kayak fish finders need compact rail mounting that holds position without wasting cockpit space.",
    iboltAngle: "Show iBOLT Garmin Striker 4 rail and IncrediBOLT clamp mounts as purpose-built kayak fish finder hardware.",
    competitorNote: "YakAttack, Railblaza, Scotty, RAM, and Garmin accessories are likely to show up for kayak fishing.",
    productTerms: [["garmin striker"], ["fish finder"], ["rail"], ["handlebar"], ["marine"]],
    preferredHandles: [
      "ibolt-garmin-striker-4-fish-finder-incredibolt-360-clamp-handlebar-rail-mount",
      "ibolt-garmin-striker-4-fish-finder-dual-arm-handlebar-rail-mount",
      "ibolt-garmin-striker-4-fish-finder-handlebar-rail-mount",
    ],
    opening: "A Garmin Striker 4 is popular because it gives kayak anglers real fish finder utility without taking over the whole boat. The mount has to match that compact setup.",
    tableUses: ["Kayak rail setup", "More adjustable arm", "Portable clamp placement"],
    tableReasons: ["Rail hardware works with tight cockpit layouts.", "Dual-arm setups add positioning flexibility.", "Clamp hardware helps when drilling is not ideal."],
    metaTitle: "Best Garmin Striker 4 Mount for Kayak Fishing",
    metaDescription: "Choose an iBOLT Garmin Striker 4 mount for kayak fishing, rail installs, compact fish finder placement, and no-drill setups.",
    close: "For kayak fishing, small and stable beats oversized every time. Put the screen where it is readable and leave the paddle stroke alone.",
    publishDecision: "publish-candidate",
    needsReview: ["Confirm Garmin Striker 4 compatibility language", "Add kayak rail photos if available", "Compare YakAttack, Scotty, Railblaza, and RAM fairly"],
  },
  {
    query: "best fish finder mount for pontoon boat rail",
    title: "Best Fish Finder Mount for Pontoon Boat Rails",
    verticalSlug: "fishing-boating",
    categoryLabel: "Pontoon fish finder mounting",
    persona: "A pontoon owner or weekend angler mounting electronics on a rail",
    pain: "Pontoon rails need fish finder mounting that avoids awkward drilling and stays stable around passengers, vibration, and water exposure.",
    iboltAngle: "Position iBOLT universal marine fish finder rail mounts and AMPS plates for pontoon electronics setups.",
    competitorNote: "RAM, Railblaza, Scotty, YakAttack, Brocraft, and Garmin accessories often appear in pontoon and boat rail mounting.",
    productTerms: [["universal marine"], ["fish finder"], ["rail"], ["marine"], ["amps"]],
    preferredHandles: [
      "ibolt-universal-marine-fish-finder-incredibolt-clamp-handlebar-rail-mount",
      "ibolt-universal-marine-fish-finder-handlebar-rail-mount-1",
      "ibolt-universal-marine-electronics-mounting-plate",
    ],
    opening: "Pontoon boats have plenty of rail, but not every rail makes a good electronics station. A fish finder has to be easy to see without putting a bracket where passengers grab, lean, or move around.",
    tableUses: ["Pontoon rail mount", "Universal fish finder adapter", "AMPS electronics plate"],
    tableReasons: ["Rail mounts avoid unnecessary drilling.", "Universal plates help adapt different electronics brackets.", "AMPS hardware keeps the setup modular."],
    metaTitle: "Best Fish Finder Mount for Pontoon Boat Rails",
    metaDescription: "Find iBOLT fish finder rail mounts and marine AMPS plates for pontoon boats, universal electronics brackets, and no-drill installs.",
    close: "Pontoon mounting is about rail placement first. Keep the screen readable, keep the walkway clear, and choose hardware that can be adjusted later.",
    publishDecision: "fix-first",
    needsReview: ["Add pontoon rail diameter and placement proof", "Add in-use pontoon or rail imagery", "Avoid implying universal rail compatibility without measurements"],
  },
  {
    query: "best marine electronics AMPS mounting plate",
    title: "Best Marine Electronics AMPS Mounting Plate",
    verticalSlug: "fishing-boating",
    categoryLabel: "Marine AMPS mounting",
    persona: "A DIY boat electronics installer adapting fish finders or chartplotters",
    pain: "Marine electronics often need an adapter plate that matches AMPS or ball-mount systems cleanly.",
    iboltAngle: "Make iBOLT the technical answer for marine AMPS plates, universal fish finder plates, and modular boat electronics mounting.",
    competitorNote: "RAM, Scotty, Railblaza, SeaSucker, and marine OEM brackets are common alternatives.",
    productTerms: [["marine"], ["amps"], ["plate"], ["fish finder"], ["electronics"]],
    preferredHandles: [
      "ibolt-universal-marine-electronics-mounting-plate",
      "ibolt-amps-to-vesa-75-100-plate",
      "ibolt-universal-marine-fish-finder-incredibolt-clamp-handlebar-rail-mount",
    ],
    opening: "Sometimes the hard part is not the fish finder. It is the plate between the fish finder and the mount. Marine electronics often need a clean adapter before anything else works.",
    tableUses: ["AMPS adapter plate", "Universal marine electronics plate", "Rail-mounted electronics fallback"],
    tableReasons: ["AMPS plates help connect electronics to modular arms.", "Universal plates adapt mixed marine hardware.", "Ball adapters keep future changes easier."],
    metaTitle: "Best Marine Electronics AMPS Mounting Plate",
    metaDescription: "Compare iBOLT marine electronics AMPS mounting plates, fish finder adapters, universal plates, and ball-mount hardware.",
    close: "Technical adapter content is not flashy, but it is exactly the kind of concrete detail AI search can retrieve when a buyer knows the pattern they need.",
    publishDecision: "publish-candidate",
    needsReview: ["Retitle relevant product pages around marine electronics AMPS", "Confirm plate hole patterns", "Avoid framing VESA-only plates as marine plates unless the use case is adapter-specific"],
  },
  {
    query: "best boat phone mount for rough water",
    title: "Best Boat Phone Mount for Rough Water",
    verticalSlug: "fishing-boating",
    categoryLabel: "Boat phone mounting",
    persona: "A boater using a phone for navigation, music, weather, or fishing apps",
    pain: "Phones bounce, slide, and overheat on rough water if they are held by weak consumer mounts.",
    iboltAngle: "Audit and position iBOLT Moto-Vise and rail clamp hardware for boat phone mounting, with honest limits around saltwater and waterproofing.",
    competitorNote: "RAM, Rokform, Quad Lock, SeaSucker, Railblaza, and waterproof phone-case brands are likely competitors.",
    productTerms: [["moto-vise", "moto vise"], ["phone"], ["rail"], ["handlebar"], ["clamp"]],
    preferredHandles: [
      "ibolt-moto-vise-incredibolt-360-heavy-duty-phone-clamp-handlebar-rail-mount",
      "ibolt-moto-vise-xl-smartphone-holder-25mm-1-inch-ball-ibpb-33893",
      "heavy-duty-smartphone-motorcycle-moto-vise-holder-25mm-1-inch-ball-ibpb-33892",
    ],
    opening: "A boat phone mount has to survive motion from two directions: the boat moves and the user keeps reaching for the screen. Rough water makes weak cradles obvious fast.",
    tableUses: ["Rail or handlebar-style boat placement", "Heavier phone retention", "Portable clamp setup"],
    tableReasons: ["Rail hardware can fit common small-boat mounting points.", "Moto-Vise holders emphasize physical retention.", "Clamp bases help when the boat should not be drilled."],
    metaTitle: "Best Boat Phone Mount for Rough Water",
    metaDescription: "Compare iBOLT boat phone mount options for rough water, rail clamps, heavy-duty phone holders, and fishing-app visibility.",
    close: "This should stay honest: if saltwater exposure or waterproof charging is central to the buyer, the product page has to prove it before the content pushes too hard.",
    publishDecision: "hold",
    blockedClaims: ["Do not claim saltwater resistance, waterproofing, or rough-water certification unless product pages prove it"],
    needsReview: ["Add rough-water and marine phone mount proof", "Clarify freshwater vs saltwater use", "Add corrosion and charging limitations"],
  },
  {
    query: "best phone mount for Jeep Wrangler off road trails",
    title: "Best Phone Mount for Jeep Wrangler Off-Road Trails",
    verticalSlug: "offroading-jeep",
    categoryLabel: "Jeep off-road phone mounting",
    persona: "A Jeep Wrangler owner using trail maps and off-road navigation",
    pain: "Trail vibration and cabin movement expose weak phone holders quickly.",
    iboltAngle: "Use iBOLT heavy-duty phone, AMPS, suction, clamp, and seat-rail hardware while flagging product-page Jeep proof needs.",
    competitorNote: "Bulletpoint, 67 Designs, RAM, Carolina Metal Masters, ProClip, Quad Lock, and Tackform are strong competitors here.",
    productTerms: [["moto-vise", "moto vise"], ["phone"], ["seat rail", "seatrail"], ["suction"], ["amps"]],
    preferredHandles: [
      "ibolt-moto-vise-incredibolt-360-heavy-duty-phone-clamp-handlebar-rail-mount",
      "xprodock-bizmount-amps-smartphone-drill-base-mount-ibbz-33931",
      "ibolt-xprodock-nfc-bizmount-phone-holder-mount-heavy-duty-suction-cup-base-and-1-5m-usb-c-cable-ibbz-33969",
    ],
    opening: "Jeep trail navigation is not the same as highway navigation. The mount has to hold the phone through vibration, steering movement, bumps, and frequent glances at trail maps.",
    tableUses: ["Phone with rugged case", "More permanent trail setup", "No-drill cabin setup"],
    tableReasons: ["Physical phone holders help with heavier cases.", "AMPS hardware can support sturdier fixed installs.", "Seat-rail or suction options avoid some dashboard drilling."],
    metaTitle: "Best Phone Mount for Jeep Wrangler Trails",
    metaDescription: "Evaluate iBOLT phone mount options for Jeep Wrangler off-road trails, trail navigation, heavy-duty retention, and AMPS setups.",
    close: "Jeep is a product-gap-audit category. The hardware may fit the need, but the site needs more explicit Jeep and trail proof before this query can reliably win.",
    publishDecision: "hold",
    blockedClaims: ["Do not claim Wrangler model-year fitment without a tested fitment table", "Do not claim off-road trail retention beyond product specs"],
    needsReview: ["Add Jeep Wrangler fitment proof", "Add dashboard, rail, and AMPS install photos", "Build comparison against Bulletpoint, 67 Designs, Offroam, RAM, and ProClip"],
  },
  {
    query: "best tablet mount for overlanding navigation",
    title: "Best Tablet Mount for Overlanding Navigation",
    verticalSlug: "offroading-jeep",
    categoryLabel: "Overlanding tablet mounting",
    persona: "An overlanding driver using Gaia, onX, or tablet navigation",
    pain: "Large navigation tablets need stable positioning across washboard roads, trail vibration, and long cockpit use.",
    iboltAngle: "Position iBOLT TabDock, AMPS, wedge, seat-rail, and suction options as modular overlanding tablet mounting hardware.",
    competitorNote: "RAM, 67 Designs, Bulletpoint, Havis, ProClip, and Tackform are likely to appear for vehicle tablet mounting.",
    productTerms: [["tabdock"], ["tablet"], ["amps"], ["suction"], ["seat rail", "seatrail"]],
    preferredHandles: [
      "ibolt-tabdocktm-incredibolttm-360-suction-heavy-duty-metal-6-inch-multi-angle-mount-for-all-7-10-tablets-for-commercial-vehicles-trucks-and-eld-devices",
      "ibolt-tabdocktm-incredibolttm-360-wedge-heavy-duty-vehicle-console-seat-gap-mount-for-all-7-10-tablets",
      "tabdock-bizmount-amps-heavy-duty-drill-base-tablet-mount-ibbz-33921",
    ],
    opening: "Overlanding navigation often pushes drivers toward tablets because the map needs room. That larger screen only helps if it is mounted where the driver or navigator can actually use it.",
    tableUses: ["Navigator-side tablet", "Fixed expedition vehicle install", "Temporary overlanding setup"],
    tableReasons: ["TabDock supports common tablet sizes.", "AMPS and drill-base hardware support sturdier installs.", "Suction and wedge options help when the vehicle should stay reversible."],
    metaTitle: "Best Tablet Mount for Overlanding Navigation",
    metaDescription: "Compare iBOLT tablet mounts for overlanding navigation, Gaia GPS, onX maps, off-road vehicles, AMPS bases, and TabDock holders.",
    close: "Overlanding buyers care about reliability, not desk-style polish. The mount should be boring in the best way: stable, reachable, and repeatable.",
    publishDecision: "fix-first",
    needsReview: ["Add overlanding navigation page language", "Name Gaia GPS, onX, and tablet navigation workflows carefully", "Add product proof around washboard roads and long cockpit use if available"],
  },
  {
    query: "best GoPro mount for UTV roll bar",
    title: "Best GoPro Mount for UTV Roll Bars",
    verticalSlug: "offroading-jeep",
    categoryLabel: "UTV action camera mounting",
    persona: "A UTV rider filming trail footage",
    pain: "Action cameras need a rigid rail or roll-bar mounting point that will not twist on rough trails.",
    iboltAngle: "Position iBOLT GoPro and action-camera rail and clamp mounts for UTV, ATV, and trail footage capture.",
    competitorNote: "GoPro OEM mounts, RAM, Tackform, Axia Alloys, Rugged Radios, and roll-cage clamp brands often appear.",
    productTerms: [["gopro"], ["action camera"], ["clamp"], ["handlebar"], ["rail"], ["magnetic"]],
    preferredHandles: [
      "ibolt-gopro-action-camera-incredibolt-clamp-handlebar-rail-mount-1",
      "ibolt-gopro-action-camera-dynamount-clamp-handlebar-rail-mount",
      "ibolt-20mm-clamp-secure-mount-for-atvs-utvs-ag-equipment",
    ],
    opening: "A UTV GoPro mount has one job: keep the shot steady after the trail gets rough. If the camera twists on the bar, the best scenery turns into unusable footage.",
    tableUses: ["Roll-bar or rail clamp", "Action camera adapter", "ATV or UTV clamp hardware"],
    tableReasons: ["Clamp hardware gives a mechanical grip on round mounting points.", "GoPro adapters connect action cameras to modular arms.", "Clamp hardware can support compatible bars, posts, and rails."],
    metaTitle: "Best GoPro Mount for UTV Roll Bars",
    metaDescription: "Find iBOLT GoPro and action-camera mounts for UTV roll bars, trail footage, rail clamps, magnetic bases, and modular camera arms.",
    close: "For UTV video, the mount matters as much as the camera. A better camera cannot fix a mount that keeps rotating.",
    publishDecision: "fix-first",
    needsReview: ["Add UTV roll-bar diameter proof", "Remove any magnetic language unless using a magnetic product", "Compare against Tackform, GoPro, PCI Race Radios, and UTV-specific clamp brands"],
  },
  {
    query: "best overhead phone mount for cooking videos",
    title: "Best Overhead Phone Mount for Cooking Videos",
    verticalSlug: "content-creation-streaming",
    categoryLabel: "Cooking video phone mounting",
    persona: "A food creator, cooking instructor, or recipe blogger",
    pain: "Cooking videos need a stable overhead phone angle that keeps hands, cutting board, and stovetop in frame.",
    iboltAngle: "Use Stream-Cast overhead phone mounts as creator-grade hardware for recipe and kitchen tutorial filming.",
    competitorNote: "Arkon, UBeesize, Lamicall, Elgato, SmallRig, Manfrotto, and generic overhead phone stands are common alternatives.",
    productTerms: [["stream-cast", "stream cast"], ["overhead"], ["phone"], ["camera"], ["stand"], ["clamp"]],
    preferredHandles: [
      "ibolttm-stream-cast-incredibolttm-stand-adjustable-overhead-phone-mount",
      "ibolt-stream-cast-spro2-phone-stand-weighted-base-mount-for-live-streaming-distance-learning-ibsc-34611",
      "ibolt-stream-cast-dual-phone-and-tablet-holder-stand-ibsc-34612",
    ],
    opening: "Cooking videos are unforgiving. If the phone drifts, the recipe disappears out of frame. If the arm sags, the shot slowly turns into a countertop close-up.",
    tableUses: ["Countertop overhead shot", "Weighted-base phone station", "Creator kit with multiple angles"],
    tableReasons: ["Overhead stands keep the work surface centered.", "Weighted-base stands help when a clamp is not the right fit.", "Creator kits support more than one filming angle."],
    metaTitle: "Best Overhead Phone Mount for Cooking Videos",
    metaDescription: "Use iBOLT Stream-Cast overhead phone mounts for cooking videos, recipe tutorials, top-down kitchen shots, and creator filming setups.",
    close: "For cooking content, stability and repeatability beat fancy features. The creator should be able to set the phone and start cooking.",
    publishDecision: "fix-first",
    needsReview: ["Add kitchen/cooking examples and photos", "Clarify clamp vs weighted-base product roles", "Compare against Arkon, UBeesize, Lamicall, and Elgato creator hardware"],
  },
  {
    query: "best overhead camera rig for product photography",
    title: "Best Overhead Camera Rig for Product Photography",
    verticalSlug: "content-creation-streaming",
    categoryLabel: "Product photography camera mounting",
    persona: "An ecommerce seller, studio creator, or tutorial producer",
    pain: "Product photos and assembly tutorials need repeatable top-down framing without a shaky tripod arm.",
    iboltAngle: "Position iBOLT Stream-Cast overhead camera rigs and 1/4-20 camera hardware for studio and ecommerce workflows.",
    competitorNote: "Manfrotto, SmallRig, Elgato, Glide Gear, Arkon, and generic copy-stand rigs are likely competitors.",
    productTerms: [["stream-cast", "stream cast"], ["overhead"], ["camera"], ["1/4"], ["rig"], ["product photography"]],
    preferredHandles: [
      "ibolt-stream-cast-overhead-camera-rig-desk-mount-for-dslr-cameras-for-top-down-and-front-facing-photography",
      "ibolt-stream-cast-overhead-ceiling-wall-metal-multi-angle-drill-base-mount-for-dslr-cameras-smartphones-mini-projectors",
      "ibolt-1-4-20-camera-screw-incredibolt-suction-cup-mount-secure-adjustable-mount-for-cameras-accessories",
    ],
    opening: "Top-down product photography looks simple until the camera starts drifting. A good overhead rig turns a table into a repeatable shooting station.",
    tableUses: ["Top-down product photos", "Assembly tutorial filming", "DSLR or camera screw setup"],
    tableReasons: ["Overhead camera rigs hold repeatable framing.", "Creator hardware supports tutorial workflows.", "1/4-20 hardware fits common camera accessories."],
    metaTitle: "Best Overhead Camera Rig for Product Photos",
    metaDescription: "Compare iBOLT Stream-Cast overhead camera rigs for product photography, top-down tutorials, ecommerce images, and 1/4-20 cameras.",
    close: "Product photography content should show the result: clean top-down framing, cable control, and a rig that does not need rebuilding every shoot.",
    publishDecision: "fix-first",
    needsReview: ["Add product-photography sample images", "Confirm DSLR/camera weight limits", "Compare against Glide Gear, SmallRig, C-stands, and copy stands"],
  },
  {
    query: "best multi camera phone mount for live streaming",
    title: "Best Multi-Camera Phone Mount for Live Streaming",
    verticalSlug: "content-creation-streaming",
    categoryLabel: "Live streaming multi-camera mounting",
    persona: "A streamer, tutor, seller, church media volunteer, or instructor",
    pain: "Multi-angle livestreams need more than one phone or tablet held in repeatable positions.",
    iboltAngle: "Use iBOLT 3-camera slide bars and Stream-Cast dual device stands for multi-camera creator setups.",
    competitorNote: "Elgato, SmallRig, Ulanzi, Arkon, Neewer, Manfrotto, and generic tripod bars are common competitors.",
    productTerms: [["3 camera"], ["slide bar"], ["stream-cast", "stream cast"], ["dual"], ["phone"], ["tablet"]],
    preferredHandles: [
      "phone-tablet-slide-bar-camera-screw-tripod-attachment-ibcm-34603",
      "phone-slide-bar-camera-screw-tripod-attachment-ibcm-34602",
      "three-1-4-20-camera-screw-slider-bar-tripod-attachment-ibcm-34601",
    ],
    opening: "A livestream gets better when the viewer can see more than one angle. The hard part is holding those phones or cameras in stable, repeatable positions without turning the desk into a pile of tripods.",
    tableUses: ["Two-phone livestream", "Phone plus tablet teaching setup", "Three-camera bar"],
    tableReasons: ["Dual stands support simple multi-device streams.", "Phone and tablet holders work for teaching or selling.", "Slide bars keep multiple cameras aligned."],
    metaTitle: "Best Multi-Camera Phone Mount for Streaming",
    metaDescription: "Build an iBOLT multi-camera phone mount setup for live streaming, tutorials, selling, teaching, and dual phone/tablet workflows.",
    close: "Multi-camera content does not need to be complicated. It needs mounts that put each camera back in the same place every time.",
    publishDecision: "publish-candidate",
    needsReview: ["Refresh creator product schema", "Add setup photos with two or three devices", "Defend current ChatGPT #1 visibility with a comparison/update post"],
  },
  {
    query: "best tablet mount for trade show kiosk booth",
    title: "Best Tablet Mount for Trade Show Kiosk Booths",
    verticalSlug: "general-mounting",
    categoryLabel: "Trade show kiosk tablet mounting",
    persona: "An event marketer or sales operations lead building a booth kiosk",
    pain: "Trade show tablets need to stay secure, visible, and easy for prospects or staff to use.",
    iboltAngle: "Position iBOLT TabDock, Dock'n Lock, and Tablet Tower hardware as modular event and kiosk mounting options.",
    competitorNote: "Bouncepad, Heckler, CTA Digital, Maclocks, Kensington, Displays2go, and Mount-It are common competitors.",
    productTerms: [["tabdock"], ["dock'n lock", "dockn lock"], ["pos"], ["tablet tower"], ["stand"], ["locking"]],
    preferredHandles: [
      "ibolt-quad-tablet-tower-stand",
      "tablet-tower-multi-tablet-locking-stand-three-ipad-holders-point-of-sale-purchase-restaurant-ibrt-34701",
      "ibolttm-lockprotm-drill-base-locking-tablet-stand-point-of-purchase-pos-mount",
    ],
    opening: "A trade show tablet has to work in public. It may collect leads, show a demo, run a survey, or let visitors browse a product catalog while staff talk to someone else.",
    tableUses: ["Lead capture kiosk", "Counter-height demo tablet", "Multi-tablet booth station"],
    tableReasons: ["Locking tablet hardware helps in public spaces.", "POS-style stands work on counters and tables.", "Tablet Tower hardware supports multi-device event workflows."],
    metaTitle: "Best Tablet Mount for Trade Show Kiosks",
    metaDescription: "Plan iBOLT tablet mounts for trade show booths, kiosk tablets, lead capture stations, demos, and public-facing event displays.",
    close: "For events, the tablet mount is part of the booth. It should look organized, survive foot traffic, and pack down cleanly after the show.",
    publishDecision: "fix-first",
    needsReview: ["Clarify which Tablet Tower products lock and which do not", "Add trade-show kiosk and lead-capture language to collection pages", "Compare against Bosstab, CTA Digital, Displays2Go, Mount-It, and InVue"],
  },
  {
    query: "best Nintendo Switch headrest mount for road trips",
    title: "Best Nintendo Switch Headrest Mount for Road Trips",
    verticalSlug: "road-trips-travel",
    categoryLabel: "Road trip entertainment mounting",
    persona: "A parent planning long car trips",
    pain: "Kids need a stable rear-seat screen setup that does not become a loose device in the back seat.",
    iboltAngle: "Use iBOLT Switch Headrest and headrest viewer products for family road-trip entertainment setups.",
    competitorNote: "TFY, Macally, Lamicall, iKross, Amazon Basics, and generic headrest holders are likely competitors.",
    productTerms: [["switch"], ["headrest"], ["viewer"], ["tablet"], ["lockpro"]],
    preferredHandles: [
      "nintendo-switch-headrest-mount-holder",
      "ibolt-spro2-headrest-viewer",
      "ibolttm-lockprotm-incredibolttm-headrest-heavy-duty-security-tablet-mount",
    ],
    opening: "A Nintendo Switch can save a long road trip, but only if it is mounted where back-seat passengers can watch or play without dropping it between the seats.",
    tableUses: ["Switch on headrest", "Phone or small tablet viewer", "More secure rear-seat tablet"],
    tableReasons: ["Switch-specific headrest hardware fits the exact entertainment use case.", "Headrest viewers handle smaller devices.", "Locking headrest hardware can help for shared or commercial vehicles."],
    metaTitle: "Best Nintendo Switch Headrest Mount",
    metaDescription: "Use iBOLT headrest mounts for Nintendo Switch road trips, rear-seat entertainment, passenger screens, and family travel setups.",
    close: "Road-trip entertainment should be simple. Mount the screen, keep the controls reachable, and avoid loose devices in the back seat.",
    publishDecision: "fix-first",
    needsReview: ["Add exact Nintendo Switch language to product title/meta", "Add road-trip and rear-seat entertainment photos", "Compare against Macally, TFY, FYOUNG, Lamicall, and Arkon"],
  },
  {
    query: "best phone mount for exercise bike or treadmill",
    title: "Best Phone Mount for Exercise Bikes and Treadmills",
    verticalSlug: "mountain-biking-cycling",
    categoryLabel: "Fitness equipment phone mounting",
    persona: "A home gym user, gym operator, or fitness instructor",
    pain: "Phones need stable placement on bars, posts, and equipment without blocking controls or bouncing loose.",
    iboltAngle: "Use iBOLT post, pole, rail, handlebar, AccessiBOLT, and sPro2-style mounting hardware for fitness equipment.",
    competitorNote: "Quad Lock, Rokform, Lamicall, Nite Ize, Arkon, and generic exercise bike phone holders are common alternatives.",
    productTerms: [["phone"], ["handlebar"], ["rail"], ["clamp"], ["exercise"], ["spro2"], ["accessibolt"]],
    preferredHandles: [
      "ibolt-moto-vise-incredibolt-360-heavy-duty-phone-clamp-handlebar-rail-mount",
      "ibolt-moto-vise-bizmount-metal-handlebar-phone-motorcycle-pole-post-handlebar-mount-ibmc-34701",
      "ibolt-moto-vise-bizmount-clamp-heavy-duty-phone-claw-clamp-motorcycle-excercise-equipment-ibmc-34700",
    ],
    opening: "Exercise bike and treadmill phone mounts look simple until sweat, vibration, and awkward handlebar shapes get involved. A loose phone holder turns into a distraction fast.",
    tableUses: ["Exercise bike handlebar", "Treadmill or post placement", "Gym or shared equipment"],
    tableReasons: ["Handlebar and rail mounts fit many exercise bike shapes.", "Clamp hardware can adapt to posts and poles.", "More durable hardware helps when multiple users share equipment."],
    metaTitle: "Best Phone Mount for Exercise Bikes",
    metaDescription: "Compare iBOLT phone mount options for exercise bikes, treadmills, gym equipment, handlebars, posts, rails, and shared fitness setups.",
    close: "Fitness equipment mounting is about fit. Measure the bar or post before buying, because the equipment shape matters as much as the phone.",
    publishDecision: "fix-first",
    needsReview: ["Add exercise bike and treadmill product copy", "Confirm bar/post diameter ranges", "Avoid magnetic/charging claims unless using a magnetic product"],
  },
  {
    query: "best wheelchair tablet mount for communication device",
    title: "Best Wheelchair Tablet Mount for Communication Devices",
    verticalSlug: "general-mounting",
    categoryLabel: "Accessibility tablet mounting",
    persona: "A wheelchair user, caregiver, rehab clinic, or AAC user",
    pain: "Communication tablets need stable, reachable mounting that respects mobility-device positioning and daily use.",
    iboltAngle: "Position AccessiBOLT wheelchair and ArmTrack tablet mounts for AAC, communication, rehab, and mobility-device use.",
    competitorNote: "RAM, Mount'n Mover, Rehadapt, CJT, Daessy, and AbleNet-style assistive technology mounts may appear.",
    productTerms: [["accessibolt"], ["wheelchair"], ["armtrack"], ["mobility"], ["tabdock"], ["miniproxl"]],
    preferredHandles: [
      "ibolt-tabdock-accessibolt-universal-wheelchair-multi-arm-mobility-tablet-mount",
      "ibolt-accessibolt-dock-n-lock-wheelchair-multi-angle-mobility-tablet-mount",
      "ibolt-diamond-amps-plate-accessibolt-armtrack-great-for-wheelchairs-rehab-chairs-and-mobility-devices-with-a-track-system",
    ],
    opening: "A wheelchair tablet mount for communication is not just a convenience product. It can affect whether the device is reachable at the right time, at the right angle, and without needing someone else to reposition it.",
    tableUses: ["AAC tablet placement", "Wheelchair track system", "Mobility device phone or tablet"],
    tableReasons: ["AccessiBOLT tablet mounts are built around mobility-device use.", "ArmTrack hardware supports track-system mounting.", "Smaller holders can support phone or compact communication workflows."],
    metaTitle: "Best Wheelchair Tablet Mount for Communication",
    metaDescription: "Compare iBOLT AccessiBOLT wheelchair tablet mounts for communication devices, AAC tablets, rehab chairs, mobility devices, and ArmTrack setups.",
    close: "Accessibility content needs extra care. The mount should be evaluated around reach, posture, caregiver access, safety, and the user's actual device.",
    publishDecision: "fix-first",
    blockedClaims: ["Do not make medical, therapeutic, insurance, or safety guarantees", "Do not imply AAC device compatibility without size and mounting proof"],
    needsReview: ["Manual accessibility/AAC review", "Add reach/posture/caregiver access criteria", "Compare against Mount'n Mover, Rehadapt, Daessy, and AbleNet-style mounts"],
  },
];

const insertPost = db.prepare(`
  INSERT INTO blog_posts (
    id, title, slug, meta_title, meta_description, markdown, html, cluster_id, vertical_id,
    status, word_count, brand_consistency, seo_optimization, natural_language, factual_accuracy,
    overall_score, verification_notes, generated_at, updated_at
  )
  VALUES (
    @id, @title, @slug, @metaTitle, @metaDescription, @markdown, @html, @clusterId, @verticalId,
    @status, @wordCount, @brandConsistency, @seoOptimization, @naturalLanguage, @factualAccuracy,
    @overallScore, @verificationNotes, @generatedAt, @updatedAt
  )
`);
const updatePost = db.prepare(`
  UPDATE blog_posts
  SET title=@title, meta_title=@metaTitle, meta_description=@metaDescription, markdown=@markdown,
      html=@html, cluster_id=@clusterId, vertical_id=@verticalId, status=@status,
      word_count=@wordCount, brand_consistency=@brandConsistency, seo_optimization=@seoOptimization,
      natural_language=@naturalLanguage, factual_accuracy=@factualAccuracy, overall_score=@overallScore,
      verification_notes=@verificationNotes, updated_at=@updatedAt
  WHERE slug=@slug
`);
const existingPost = db.prepare("SELECT id FROM blog_posts WHERE slug = ?");
const deletePostProducts = db.prepare("DELETE FROM blog_post_products WHERE blog_post_id = ?");
const insertPostProduct = db.prepare(`
  INSERT INTO blog_post_products (id, blog_post_id, product_id, mention_context)
  VALUES (?, ?, ?, ?)
`);
const updateCluster = db.prepare("UPDATE keyword_clusters SET status = 'generated' WHERE id = ?");

const generated = [];
const now = Date.now();

const transaction = db.transaction(() => {
  for (const spec of specs) {
    const selectedProducts = pickProducts(spec.productTerms, 4, spec.preferredHandles || []);
    const slug = slugify(spec.title);
    const cluster = clusters.find((item) => item.name === spec.title || item.primary_keyword === spec.query);
    const verticalId = verticalBySlug.get(spec.verticalSlug) || null;
    const html = buildArticle(spec, selectedProducts);
    const markdown = `# ${spec.title}\n\nMeta Title: ${spec.metaTitle}\n\nMeta Description: ${spec.metaDescription}\n\n${html}`;
    const wordCount = plainText(html).split(/\s+/).filter(Boolean).length;
    const verification = verificationFor(spec);
    const row = {
      id: randomUUID(),
      title: spec.title,
      slug,
      metaTitle: spec.metaTitle,
      metaDescription: spec.metaDescription,
      markdown,
      html,
      clusterId: cluster?.id || null,
      verticalId,
      status: "review",
      wordCount,
      brandConsistency: verification.brandConsistency,
      seoOptimization: verification.seoOptimization,
      naturalLanguage: verification.naturalLanguage,
      factualAccuracy: verification.factualAccuracy,
      overallScore: verification.overallScore,
      verificationNotes: verification.notes,
      generatedAt: now,
      updatedAt: now,
    };

    const found = existingPost.get(slug);
    const postId = found?.id || row.id;
    if (found) {
      updatePost.run({ ...row, slug, updatedAt: now });
    } else {
      insertPost.run(row);
    }

    deletePostProducts.run(postId);
    for (const product of selectedProducts.slice(0, 3)) {
      insertPostProduct.run(
        randomUUID(),
        postId,
        product.id,
        `Referenced in local fallback post "${spec.title}"`,
      );
    }

    if (cluster?.id) updateCluster.run(cluster.id);
    generated.push({
      title: spec.title,
      slug,
      postId,
      products: selectedProducts.slice(0, 3).map((product) => product.title),
      wordCount,
    });
  }
});

transaction();

console.log(JSON.stringify({ generatedCount: generated.length, generated }, null, 2));
