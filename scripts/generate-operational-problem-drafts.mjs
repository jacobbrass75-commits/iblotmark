#!/usr/bin/env node

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";

const SHOPIFY_SHOP = (process.env.SHOPIFY_SHOP || "iboltmounts").replace(/\.myshopify\.com$/i, "");
const SHOPIFY_TOKEN =
  process.env.SHOPIFY_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const SHOPIFY_NEWS_BLOG_ID = Number(process.env.SHOPIFY_NEWS_BLOG_ID || 104843772196);
const MODEL = process.env.BLOG_ANTHROPIC_MODEL || "claude-sonnet-4-6";
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_SHOPIFY = process.argv.includes("--skip-shopify") || DRY_RUN;
const ONLY_SLUG = process.argv.find((arg) => arg.startsWith("--slug="))?.split("=")[1] || "";
const LIMIT = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] || 0);
const BATCH = process.argv.find((arg) => arg.startsWith("--batch="))?.split("=")[1] || "operational-problems";
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = path.resolve("content-output", `${BATCH}-drafts-${TIMESTAMP}`);

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not configured.");
}
if (!SKIP_SHOPIFY && !SHOPIFY_TOKEN) {
  throw new Error("SHOPIFY_ACCESS_TOKEN or SHOPIFY_ADMIN_API_ACCESS_TOKEN is required.");
}

const bannedPhrases = [
  "game-changer",
  "revolutionize",
  "revolutionizing",
  "seamless",
  "seamlessly",
  "cutting-edge",
  "cutting edge",
  "next-level",
  "groundbreaking",
  "innovative solution",
  "state-of-the-art",
  "paradigm shift",
  "synergy",
  "leverage",
  "empower",
  "robust",
  "holistic",
  "streamline",
  "best-in-class",
  "world-class",
  "unlock the power",
  "dive into",
  "in today's fast-paced world",
  "look no further",
  "without further ado",
  "budget option",
  "affordable alternative",
  "cheaper than RAM",
  "cost-effective alternative",
  "economical choice",
];

const replacements = [
  [/game-changer/gi, "real fix"],
  [/revolutioniz(e|ing)/gi, "change"],
  [/seamless(ly)?/gi, "smooth"],
  [/cutting[- ]edge/gi, "current"],
  [/next-level/gi, "stronger"],
  [/groundbreaking/gi, "useful"],
  [/innovative solution/gi, "mounting setup"],
  [/state-of-the-art/gi, "well-built"],
  [/paradigm shift/gi, "change"],
  [/synergy/gi, "fit"],
  [/\bleverage\b/gi, "use"],
  [/\bempower\b/gi, "help"],
  [/\brobust\b/gi, "durable"],
  [/\bholistic\b/gi, "complete"],
  [/\bstreamline\b/gi, "simplify"],
  [/best-in-class/gi, "commercial-grade"],
  [/world-class/gi, "commercial-grade"],
  [/unlock the power/gi, "use"],
  [/dive into/gi, "look at"],
  [/in today's fast-paced world/gi, "For busy teams"],
  [/look no further/gi, "start here"],
  [/without further ado/gi, ""],
  [/budget option/gi, "entry setup"],
  [/affordable alternative/gi, "practical option"],
  [/cheaper than RAM/gi, "compatible with industry-standard systems"],
  [/cost-effective alternative/gi, "practical option"],
  [/economical choice/gi, "practical choice"],
  [/\bpermanently\b/gi, "for the long term"],
  [/\bguarantee(s|d)?\b/gi, "support"],
];

const sourceSets = {
  restaurant: [
    {
      label: "DoorDash Merchant Tablet Learning Center",
      url: "https://merchants.doordash.com/en-us/learning-center/topic/tablet",
      use: "DoorDash says the merchant tablet is used for order and store management tasks in real time.",
    },
    {
      label: "Uber Eats Help: not accepting orders on tablet",
      url: "https://help.uber.com/merchants-and-restaurants/article/not-accepting-orders-on-tablet?nodeId=6700aacd-8999-4b8a-9c68-65c199796642",
      use: "Uber Eats notes that its Orders app needs to stay visible in the foreground and can pause after missed orders or offline time.",
    },
    {
      label: "Grubhub tablet setup",
      url: "https://get.grubhub.com/help-center/grubhub-tablet-setup/",
      use: "Use as a general official setup reference for third-party restaurant tablets.",
    },
  ],
  vehicle: [
    {
      label: "FMCSA mobile phone restrictions fact sheet",
      url: "https://www.fmcsa.dot.gov/driver-safety/distracted-driving/mobile-phone-restrictions-fact-sheet",
      use: "FMCSA emphasizes safe, hands-free placement for commercial drivers.",
    },
    {
      label: "NHTSA distracted driving overview",
      url: "https://www.nhtsa.gov/risky-driving/distracted-driving",
      use: "Use for general safety framing around reaching, visibility, and attention.",
    },
    {
      label: "Apple Support: iPhone or iPad gets too hot or too cold",
      url: "https://support.apple.com/en-us/118431",
      use: "Apple warns that hot cars, direct sunlight, navigation, and charging can contribute to device temperature problems.",
    },
    {
      label: "Samsung Support: keep Galaxy devices at normal operating temperature",
      url: "https://www.samsung.com/us/support/answer/ANS10002887/",
      use: "Samsung lists direct sunlight, hot parked vehicles, GPS, multiple apps, and charging as heat contributors.",
    },
    {
      label: "OSHA motor vehicle safety: distracted driving",
      url: "https://www.osha.gov/motor-vehicle-safety/distracted-driving",
      use: "OSHA frames phone and GPS use as a driver-distraction risk employers should manage.",
    },
  ],
  amazonFlex: [
    {
      label: "Amazon Flex FAQ",
      url: "https://flex.amazon.com/support/faq",
      use: "Amazon Flex lists phone requirements including GPS, camera, SIM card, current OS, and Android battery minimums.",
    },
    {
      label: "NHTSA distracted driving overview",
      url: "https://www.nhtsa.gov/risky-driving/distracted-driving",
      use: "Use for general safety framing around reaching, visibility, and attention.",
    },
    {
      label: "Apple Support: iPhone or iPad gets too hot or too cold",
      url: "https://support.apple.com/en-us/118431",
      use: "Apple warns that hot cars, direct sunlight, navigation, and charging can contribute to device temperature problems.",
    },
    {
      label: "Samsung Support: keep Galaxy devices at normal operating temperature",
      url: "https://www.samsung.com/us/support/answer/ANS10002887/",
      use: "Samsung lists direct sunlight, hot parked vehicles, GPS, multiple apps, and charging as heat contributors.",
    },
  ],
  constructionCabs: [
    {
      label: "Knapheide truck bodies",
      url: "https://www.knapheide.com/truck-bodies/",
      use: "Use for work-body distinctions such as service bodies, platform bodies, dump bodies, and utility bodies.",
    },
    {
      label: "Monroe Truck Equipment work trucks",
      url: "https://commercial.monroetruck.com/work-trucks/",
      use: "Use for work-truck body-type context and vocational use cases.",
    },
    {
      label: "FMCSA portable ELD visibility FAQ",
      url: "https://www.fmcsa.dot.gov/hours-service/elds/can-driver-use-portable-electronic-logging-device-eld",
      use: "FMCSA says a portable ELD must be mounted in a fixed position and visible to the driver from the normal seated position.",
    },
    {
      label: "FMCSA mobile phone restrictions fact sheet",
      url: "https://www.fmcsa.dot.gov/driver-safety/distracted-driving/mobile-phone-restrictions-fact-sheet",
      use: "Use for cautious hands-free, close-proximity safety framing around phones in commercial vehicles.",
    },
  ],
  workTruckModels: [
    {
      label: "Ford Pro Chassis Cab",
      url: "https://www.fordpro.com/en-us/fleet-vehicles/chassis-cab/",
      use: "Use for upfit-ready Ford commercial truck context.",
    },
    {
      label: "GM Fleet Silverado HD",
      url: "https://www.gmfleet.com/vehicles/trucks/chevrolet-silverado-hd",
      use: "Use for Silverado HD fleet and work-truck context.",
    },
    {
      label: "Ram Chassis Cab versatility",
      url: "https://www.ramtrucks.com/ram-chassis-cab/versatility.html",
      use: "Use for Ram chassis cab, wheelbase, cab-to-axle, and upfit context.",
    },
    {
      label: "Freightliner M2 106 Plus",
      url: "https://www.freightliner.com/trucks/m2-106-plus/",
      use: "Use for medium-duty cab and vocational truck context.",
    },
    {
      label: "Chevrolet Express Cutaway",
      url: "https://www.chevrolet.com/commercial/express/cutaway",
      use: "Use for cutaway van and service/upfit body context.",
    },
  ],
  offroad: [
    {
      label: "RAM Mounts X-Grip",
      url: "https://rammount.com/pages/x-grip",
      use: "Use as a fair competitor/product-class reference for spring-loaded phone cradles and optional tether use.",
    },
    {
      label: "Bulletpoint Mounting Solutions",
      url: "https://www.bulletpointmountingsolutions.com/pages/jeep",
      use: "Use as a fair competitor/product-class reference for Jeep-specific multi-device dash systems.",
    },
    {
      label: "ProClip USA",
      url: "https://www.proclipusa.com/",
      use: "Use as a fair competitor/product-class reference for vehicle-specific, no-drill interior mounts.",
    },
    {
      label: "Mopar rail phone holder",
      url: "https://www.moparonlineperformance.com/sku/68733117aa.html",
      use: "Use as an OEM-style Jeep dash rail and phone holder example.",
    },
    {
      label: "Apple Support: iPhone or iPad gets too hot or too cold",
      url: "https://support.apple.com/en-us/118431",
      use: "Use for heat and direct-sunlight context when phones run navigation on trails.",
    },
  ],
  restaurantWorkflows: [
    {
      label: "DoorDash Merchant Tablet Learning Center",
      url: "https://merchants.doordash.com/en-us/learning-center/topic/tablet",
      use: "Use for third-party delivery tablet workflow context.",
    },
    {
      label: "Uber Eats Orders app",
      url: "https://merchants.ubereats.com/us/en/technology/manage-orders/uber-eats-orders-app/",
      use: "Use for order-management app workflow context.",
    },
    {
      label: "Grubhub tablet setup",
      url: "https://get.grubhub.com/help-center/grubhub-tablet-setup/",
      use: "Use for third-party marketplace tablet setup context.",
    },
    {
      label: "Toast Kitchen Display System",
      url: "https://pos.toasttab.com/hardware/kitchen-display-system",
      use: "Use for KDS and back-of-house tablet/screen workflow context.",
    },
  ],
};

const operationalSpecs = [
  {
    title: "Restaurant Tablet Hell: How to Stop Missing DoorDash, Uber Eats, and Grubhub Orders",
    slug: "restaurant-tablet-hell-stop-missing-delivery-orders",
    vertical: "restaurants-food-delivery",
    primaryKeyword: "restaurant tablet mount",
    audience: "restaurant owners, managers, expo leads, and ghost kitchen operators",
    problem:
      "Tablets get muted, hidden, unplugged, asleep, dead, or ignored during rush, which creates missed third-party delivery orders.",
    angle:
      "Treat tablet hell as a visibility and station-design problem. Show how a vertical multi-tablet station keeps order tablets visible, powered, and assigned.",
    products: [
      "ibolt-quad-tablet-tower-stand",
      "ibolttm-lockprotm-drill-base-locking-tablet-stand-point-of-purchase-pos-mount",
      "ibolt-phone-dock-n-lock-dual-pos-stand-secure-dual-device-mount-for-point-of-sale-systems",
    ],
    sources: sourceSets.restaurant,
  },
  {
    title: "One Counter, Four Tablets: How to Organize a Delivery App Station",
    slug: "one-counter-four-tablets-delivery-app-station",
    vertical: "restaurants-food-delivery",
    primaryKeyword: "multi tablet stand for restaurant",
    audience: "quick-service restaurants, food halls, pickup counters, and ghost kitchens",
    problem:
      "Restaurants lose counter space and staff attention when separate tablets for delivery apps, POS, and pickup live wherever there is room.",
    angle:
      "Show the counter layout, cable, visibility, and role-assignment decisions that make a multi-tablet delivery station work.",
    products: [
      "ibolt-quad-tablet-tower-stand",
      "multi-tablet-stand-four-ipad-holders-point-of-sale-purchase-restaurant-ibrt-34707",
      "ibolt-tabdock-point-of-purchase-pos-wall-mount-with-4-tablet-holders",
      "ibolt-phone-dock-n-lock-dual-pos-stand-secure-dual-device-mount-for-point-of-sale-systems",
    ],
    sources: sourceSets.restaurant,
  },
  {
    title: "Why Work Truck Phone Mounts Fall Off on Jobsites",
    slug: "why-work-truck-phone-mounts-fall-off-jobsites",
    vertical: "trucking-fleet",
    primaryKeyword: "work truck phone mount",
    audience: "construction crews, contractors, service fleets, and fleet managers",
    problem:
      "Vibration, heat, dust, rough roads, and rugged cases defeat consumer mounts in construction and service trucks.",
    angle:
      "Explain the failure modes first, then map them to drill-base, AMPS, rail, and locking cradle choices.",
    products: [
      "ibolt-phone-dock-n-lock-incredibolt-amps-drill-base-mount-for-phones",
      "ibolt-phone-dock-n-lock-incredibolt-amps-w-4-25-double-socket-arm-locking-drill-base-mount-for-smartphones-great-for-trucks-eld-s-wall-mounting-sprinter-vans-etc",
      "ibolt-moto-vise-incredibolt-heavy-duty-phone-clamp-handlebar-rail-mount",
    ],
    sources: sourceSets.vehicle,
  },
  {
    title: "Heat, Dust, and Vibration: Work Truck Phone Mount Fixes",
    slug: "heat-dust-vibration-work-truck-phone-mount-fixes",
    vertical: "trucking-fleet",
    primaryKeyword: "heavy duty work truck phone mount",
    audience: "construction, utilities, field service, oil and gas, and fleet installers",
    problem:
      "Construction trucks are not normal commuting vehicles, so normal vent, adhesive, and light-duty suction mounts fail faster.",
    angle:
      "Give a practical fix list for each environmental cause: heat, dust, vibration, rugged phone cases, shared drivers, and cable strain.",
    products: [
      "ibolt-phone-dock-n-lock-incredibolt-360-heavy-duty-industrial-composite-locking-multi-angle-drill-base-mount-for-smartphones",
      "xprodock-bizmount-amps-smartphone-drill-base-mount-ibbz-33931",
      "ibolt-7-45-inch-composite-dual-ball-arm-with-metal-amps-drill-base-mount",
    ],
    sources: sourceSets.vehicle,
  },
  {
    title: "Amazon Flex Battery Drain: Mount and Charging Setup for Long Routes",
    slug: "amazon-flex-battery-drain-mount-charging-setup",
    vertical: "restaurants-food-delivery",
    primaryKeyword: "Amazon Flex phone mount",
    audience: "Amazon Flex drivers, DSP drivers, courier drivers, and gig delivery drivers",
    problem:
      "GPS, scanning, delivery notes, calls, photos, screen-on time, and charging heat can drain a phone before the route ends.",
    angle:
      "Make this a route-survival setup guide: stable placement, charging path, cable management, quick dock and undock, and heat control.",
    products: [
      "ibolt-safemag-suction-cup-mount-compatible-with-qi-magsafe-and-wireless-charging-pucks",
      "ibolt-chargedock-usb-c-amps-ultimate-magnetic-vehicle-dock-mount-holder-w-2m-usb-certified-type-c-to-usb-a-charging-cable",
      "ibolt-xprodock-nfc-bizmount-phone-holder-mount-heavy-duty-suction-cup-base-and-1-5m-usb-c-cable-ibbz-33969",
      "fixed-install-hardwire-usb-charge-30w-2-port-quick-charge-3-0-standard-usb-a",
    ],
    sources: sourceSets.amazonFlex,
  },
  {
    title: "Why Your Amazon Flex Phone Mount Keeps Falling Off in the Heat",
    slug: "amazon-flex-phone-mount-keeps-falling-off-heat",
    vertical: "restaurants-food-delivery",
    primaryKeyword: "Amazon Flex phone holder",
    audience: "Amazon Flex, grocery delivery, courier, and rideshare drivers using hot parked vehicles",
    problem:
      "Suction and adhesive mounts can lose grip in hot delivery vehicles, especially when the phone is charging and navigation is running.",
    angle:
      "Use the choppy-water pattern: a specific failure condition, heat, with a clear solution path through base choice, surface prep, AMPS, and phone cooling.",
    products: [
      "ibolt-safemag-suction-cup-mount-compatible-with-qi-magsafe-and-wireless-charging-pucks",
      "xprodock-bizmount-console-heavy-duty-phone-cup-holder-mount",
      "xprodock-bizmount-amps-smartphone-drill-base-mount-ibbz-33931",
      "heavy-duty-smartphone-suction-cup-mount-xprodock-bizmount-ibbz-33785",
    ],
    sources: sourceSets.amazonFlex,
  },
  {
    title: "Proof-of-Delivery Photos Without Dropping Your Phone at Every Stop",
    slug: "proof-of-delivery-photos-without-dropping-phone",
    vertical: "restaurants-food-delivery",
    primaryKeyword: "delivery driver phone mount",
    audience: "Amazon DSP drivers, Amazon Flex drivers, courier fleets, and grocery delivery drivers",
    problem:
      "Drivers need to scan, navigate, grab, photograph, confirm, and redock the same phone dozens or hundreds of times per route.",
    angle:
      "Show how cradle access, one-handed dock and undock, camera clearance, and mount location reduce drops and route friction.",
    products: [
      "ibolt-xprodock-nfc-bizmount-phone-holder-mount-heavy-duty-suction-cup-base-and-1-5m-usb-c-cable-ibbz-33969",
      "xprodock-bizmount-console-heavy-duty-phone-cup-holder-mount",
      "ibolt-phone-dock-n-lock-incredibolt-360-heavy-duty-industrial-composite-locking-multi-angle-drill-base-mount-for-smartphones",
    ],
    sources: sourceSets.amazonFlex,
  },
  {
    title: "Where to Mount a Phone in a Construction Truck Cab",
    slug: "where-to-mount-phone-construction-truck-cab",
    vertical: "trucking-fleet",
    primaryKeyword: "construction truck phone mount",
    audience: "contractors, foremen, service techs, field crews, and fleet installers",
    problem:
      "Windshield mounts can block view, vent mounts can block airflow, cup holders are needed, and adhesives can damage fleet vehicles.",
    angle:
      "Build a placement guide comparing windshield, dash, AMPS drill base, cup holder, seat wedge, rail, and console positions.",
    products: [
      "tabdock-bizmount-amps-heavy-duty-drill-base-tablet-mount-ibbz-33921",
      "ibolt-lockpro-flexpro-heavy-duty-locking-tablet-seat-rail-mount",
      "xprodock-bizmount-console-heavy-duty-phone-cup-holder-mount",
      "25mm-1-inch-b-size-metal-amps-pattern-adapter-plate-ibpb-33890",
    ],
    sources: sourceSets.vehicle,
  },
];

const mountFitWorkflowSpecs = [
  {
    title: "Construction Truck Cab Mounts by Cab Type",
    slug: "construction-truck-cab-mounts-by-cab-type",
    vertical: "trucking-fleet",
    primaryKeyword: "construction truck cab phone mount",
    audience: "contractors, fleet managers, installers, foremen, and field service crews",
    problem:
      "A regular pickup cab, crew cab, service body, dump truck, and van cab all create different mounting problems for phones, tablets, radios, GPS units, and charging cables.",
    angle:
      "Compare cab types first, then explain which mounting approach fits each one: vehicle-specific dash mounts, cup-holder mounts, wedge mounts, drill-base AMPS mounts, suction mounts, and rail clamps.",
    comparisonFrame:
      "Discuss product classes fairly. ProClip-style vehicle-specific mounts are good for clean no-drill installs in one model, but are less flexible for mixed fleets. RAM-style ball systems are good for modular heavy-duty builds, but can be overbuilt for a simple phone-only cab. Bulletpoint-style dash rails are strong for specific truck and Jeep interiors, but are model-specific. iBOLT fits mixed work fleets when AMPS compatibility, quick replacement parts, cup-holder/wedge placement, and drill-base options matter.",
    products: [
      "tabdock-bizmount-amps-heavy-duty-drill-base-tablet-mount-ibbz-33921",
      "ibolt-lockpro-flexpro-heavy-duty-locking-tablet-seat-rail-mount",
      "xprodock-bizmount-console-heavy-duty-phone-cup-holder-mount",
      "25mm-1-inch-b-size-metal-amps-pattern-adapter-plate-ibpb-33890",
    ],
    sources: [...sourceSets.constructionCabs, ...sourceSets.vehicle.slice(0, 2)],
  },
  {
    title: "Phone Mounts for Popular Work Trucks",
    slug: "phone-mounts-popular-work-truck-models",
    vertical: "trucking-fleet",
    primaryKeyword: "work truck phone mount",
    audience: "fleet managers and owner-operators running F-Series, Silverado, Sierra, Ram, Transit, Sprinter, and ProMaster vehicles",
    problem:
      "The most common work trucks and vans have different cab layouts, console shapes, dash materials, cup-holder positions, and upfit rules.",
    angle:
      "Map popular work truck model families to mount approaches, including where no-drill, cup-holder, wedge, suction, and AMPS drill-base setups make sense.",
    comparisonFrame:
      "Mention that vehicle-specific mounts are strong when every truck is the same model year. Universal AMPS and cup-holder/wedge systems are better when the fleet includes pickups, vans, and service trucks from multiple brands. Avoid declaring one product type best for every model.",
    products: [
      "xprodock-bizmount-amps-smartphone-drill-base-mount-ibbz-33931",
      "ibolt-phone-dock-n-lock-incredibolt-360-heavy-duty-industrial-composite-locking-multi-angle-drill-base-mount-for-smartphones",
      "heavy-duty-smartphone-suction-cup-mount-xprodock-bizmount-ibbz-33785",
      "xprodock-bizmount-console-heavy-duty-phone-cup-holder-mount",
    ],
    sources: [...sourceSets.workTruckModels, ...sourceSets.vehicle.slice(0, 2)],
  },
  {
    title: "No-Drill vs Drill-Base Mounts for Work Truck Fleets",
    slug: "no-drill-vs-drill-base-work-truck-fleets",
    vertical: "trucking-fleet",
    primaryKeyword: "no drill phone mount for work truck",
    audience: "fleet managers, installers, contractors, and leased-vehicle operators",
    problem:
      "Some work trucks cannot be drilled because they are leased, shared, resale-sensitive, or still under fleet policy, while others need permanent AMPS hardware because vibration and daily use are the real problem.",
    angle:
      "Create a decision guide for no-drill and drill-base mounting by vehicle ownership, cab surface, vibration, driver count, charging, and device security.",
    comparisonFrame:
      "Fairly compare no-drill cup-holder, wedge, suction, vehicle-specific clips, and drill-base AMPS setups. Make clear that no-drill wins for leased or rotating vehicles, while drill-base wins when repeatable placement, heavy vibration, and fixed fleet installs matter.",
    products: [
      "xprodock-bizmount-console-heavy-duty-phone-cup-holder-mount",
      "xprodock-bizmount-wedge-smartphone-seat-wedge-mount-ibbz-33930",
      "ibolt-xprodock-nfc-bizmount-phone-holder-mount-heavy-duty-suction-cup-base-and-1-5m-usb-c-cable-ibbz-33969",
      "ibolt-phone-dock-n-lock-incredibolt-amps-drill-base-mount-for-phones",
    ],
    sources: [...sourceSets.workTruckModels, ...sourceSets.vehicle],
  },
  {
    title: "Dump Truck and Utility Truck Phone Mounts",
    slug: "dump-truck-utility-truck-phone-mounts",
    vertical: "trucking-fleet",
    primaryKeyword: "dump truck phone mount",
    audience: "dump truck drivers, utility contractors, municipal crews, and vocational fleet installers",
    problem:
      "Dump trucks and utility trucks have rougher cab vibration, dirtier interiors, more gloves and radios, and fewer clean mounting surfaces than commuter pickups.",
    angle:
      "Explain why long arms, light suction mounts, and vent clips struggle in rough vocational cabs, then show when AMPS drill-base, shorter arms, locking cradles, and rail clamps are better.",
    comparisonFrame:
      "RAM-style heavy-duty arms and balls can be excellent for severe-duty cabs, but buyers still need the right phone cradle and base. ProClip-style clean dash mounts can work in lighter vocational pickups, but rougher dump/utility cabs often need a fixed AMPS base. iBOLT fits when crews want locking phone holders, AMPS bases, and replacement parts in standard sizes.",
    products: [
      "ibolt-phone-dock-n-lock-incredibolt-amps-w-4-25-double-socket-arm-locking-drill-base-mount-for-smartphones-great-for-trucks-eld-s-wall-mounting-sprinter-vans-etc",
      "ibolt-7-45-inch-composite-dual-ball-arm-with-metal-amps-drill-base-mount",
      "xprodock-bizmount-amps-smartphone-drill-base-mount-ibbz-33931",
      "ibolt-lockpro-flexpro-heavy-duty-locking-tablet-seat-rail-mount",
    ],
    sources: [...sourceSets.constructionCabs, ...sourceSets.vehicle],
  },
  {
    title: "Off-Road Phone Mount Problems and Fixes",
    slug: "off-road-phone-mount-problems-and-fixes",
    vertical: "offroading-jeep",
    primaryKeyword: "off road phone mount",
    audience: "Jeep, Bronco, Tacoma, UTV, overlanding, and trail drivers",
    problem:
      "Trail vibration, washboard roads, steep angles, direct sun, dust, and repeated camera use can expose every weak point in a normal car phone mount.",
    angle:
      "Use the specific failure modes to compare suction, magnetic, clamp, AMPS, dash rail, and tethered cradle approaches.",
    comparisonFrame:
      "Discuss RAM X-Grip-style cradles as flexible and popular, especially with a tether for rough conditions. Discuss Bulletpoint-style dash rails as strong for supported vehicle models. Discuss ProClip-style mounts as clean and vehicle-specific, but not always trail-oriented. iBOLT fits riders who want AMPS compatibility, rail clamps, charging-friendly phone holders, and modular repairability.",
    products: [
      "ibolt-moto-vise-incredibolt-360-heavy-duty-phone-clamp-handlebar-rail-mount",
      "ibolt-20mm-clamp-secure-mount-for-atvs-utvs-ag-equipment",
      "ibolt™25mm-1-inch-ball-to-clamp-post-pole-handlebar-mount",
      "xprodock-bizmount-amps-smartphone-drill-base-mount-ibbz-33931",
    ],
    sources: [...sourceSets.offroad, ...sourceSets.vehicle.slice(2, 4)],
  },
  {
    title: "Jeep and Overlanding Phone Mount Setups",
    slug: "jeep-overlanding-phone-mount-setups",
    vertical: "offroading-jeep",
    primaryKeyword: "Jeep phone mount",
    audience: "Jeep, Bronco, Tacoma, 4Runner, and overlanding drivers planning a trail-ready cockpit",
    problem:
      "A trail cockpit may need a phone, GPS, action camera, radio mic, tablet, and charger without blocking sightlines or shaking loose.",
    angle:
      "Compare dash rail, AMPS drill-base, suction, clamp, cup-holder, and magnetic approaches by trail intensity and vehicle ownership.",
    comparisonFrame:
      "Give credit where due: Bulletpoint and 67 Designs-style dash systems make sense for model-specific Jeep and truck interiors. RAM Mounts makes sense when the buyer already has RAM balls and arms. ProClip makes sense for no-drill daily-driver interiors. iBOLT makes sense when the buyer wants industry-standard AMPS and ball-size compatibility across phone, GPS, camera, and work-vehicle setups.",
    products: [
      "ibolt-moto-vise-incredibolt-heavy-duty-phone-clamp-handlebar-rail-mount",
      "ibolt-17mm-dual-ball-clamping-mount-for-handlebars-poles-posts-compatible-w-garmin-gps-systems-and-ibolt-phone-holders",
      "ibolt-17mm-dual-ball-to-amps-drill-base-mount-base-compatible-w-garmin-gps-and-ibolt-phone-holders",
      "ibolt-1-4-20-camera-screw-incredibolt-suction-cup-mount-secure-adjustable-mount-for-cameras-accessories",
    ],
    sources: sourceSets.offroad,
  },
  {
    title: "Restaurant Tablet Workflows: Separate Tablets, POS Integration, KDS, and Pickup Screens",
    slug: "restaurant-tablet-workflows-separate-tablets-pos-kds",
    vertical: "restaurants-food-delivery",
    primaryKeyword: "restaurant tablet setup",
    audience: "restaurant owners, operators, ghost kitchens, quick-service teams, and multi-location managers",
    problem:
      "Restaurants use tablets in different ways: separate marketplace tablets, POS-integrated ordering, kitchen display screens, pickup screens, self-order kiosks, and customer-facing checkout.",
    angle:
      "Explain the workflow approaches first, then show where physical mounting still matters even when software integrations reduce tablet count.",
    comparisonFrame:
      "Mention that POS-native hardware can be best for a single checkout workflow. Aggregator software can reduce tablet count, but restaurants often still need physical screens for pickup, KDS, expo, delivery acceptance, and backup workflows. Locking kiosk-style enclosures are strong for public-facing tablets. iBOLT helps when operators need multi-tablet visibility, wall/counter positioning, and modular mounting across stations.",
    products: [
      "ibolt-quad-tablet-tower-stand",
      "ibolttm-lockprotm-drill-base-locking-tablet-stand-point-of-purchase-pos-mount",
      "ibolt-tabdock-point-of-purchase-pos-wall-mount-with-4-tablet-holders",
      "ibolt-dock-n-lock-pos-tablet-stand",
    ],
    sources: sourceSets.restaurantWorkflows,
  },
  {
    title: "Restaurant Tablet Mounts by Station: Counter, Expo, Kitchen, Pickup, and Food Truck",
    slug: "restaurant-tablet-mounts-by-station-counter-expo-kitchen",
    vertical: "restaurants-food-delivery",
    primaryKeyword: "restaurant tablet mount",
    audience: "restaurant operators choosing tablet placement for front counter, expo, kitchen, pickup, food truck, and delivery stations",
    problem:
      "A tablet setup that works at checkout may fail at expo, pickup, or a food truck window because the station has different splash, heat, cable, customer access, and staff visibility needs.",
    angle:
      "Build a station-by-station guide that compares freestanding, clamp, drill-base, wall, locking, and multi-tablet tower setups.",
    comparisonFrame:
      "Mention Square or Toast-style stands as strong for their own POS terminals, but less flexible for multiple third-party tablets. Bouncepad or Compulocks-style enclosures are strong for public security, but not always ideal for fast staff access across several tablets. iBOLT helps when the restaurant needs flexible station placement, multiple tablets, wall/counter choices, and industry-standard mounting parts.",
    products: [
      "ibolt-quad-tablet-tower-stand",
      "multi-tablet-stand-four-ipad-holders-point-of-sale-purchase-restaurant-ibrt-34707",
      "ibolt-tabdock-point-of-purchase-pos-wall-mount-with-4-tablet-holders",
      "ibolt-phone-dock-n-lock-dual-pos-stand-secure-dual-device-mount-for-point-of-sale-systems",
    ],
    sources: sourceSets.restaurantWorkflows,
  },
];

const specs = BATCH === "mount-fit-workflows" ? mountFitWorkflowSpecs : operationalSpecs;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value) {
  let out = String(value || "")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, " ")
    .replace(/iBolt/g, "iBOLT")
    .replace(/Ibolt/g, "iBOLT")
    .replace(/IBOLT/g, "iBOLT");
  for (const [pattern, replacement] of replacements) out = out.replace(pattern, replacement);
  return out;
}

function wordCount(html) {
  return stripHtml(html).split(/\s+/).filter(Boolean).length;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function limitText(value, maxLength) {
  const text = cleanText(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const sliced = text.slice(0, maxLength + 1);
  const lastSpace = sliced.lastIndexOf(" ");
  return (lastSpace > 35 ? sliced.slice(0, lastSpace) : text.slice(0, maxLength)).trim();
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Claude did not return JSON.");
    return JSON.parse(match[0]);
  }
}

async function fetchAllProducts() {
  const products = [];
  for (let page = 1; page <= 12; page += 1) {
    const response = await fetch(`https://iboltmounts.com/products.json?limit=250&page=${page}`);
    if (!response.ok) {
      throw new Error(`Product catalog fetch failed on page ${page}: ${response.status}`);
    }
    const json = await response.json();
    if (!json.products?.length) break;
    products.push(...json.products);
    if (json.products.length < 250) break;
  }
  return products;
}

function productUrl(handle) {
  return `https://iboltmounts.com/products/${handle}`;
}

function productFromShopify(raw) {
  const variant = raw.variants?.[0] || {};
  const image = raw.images?.[0]?.src || raw.image?.src || "";
  return {
    handle: raw.handle,
    title: cleanText(raw.title),
    url: productUrl(raw.handle),
    image,
    price: variant.price || "",
    description: cleanText(stripHtml(raw.body_html)).slice(0, 900),
  };
}

function productBlock(product, index) {
  const price = product.price ? `$${Number(product.price).toFixed(2)}` : "";
  return `<div style="text-align: center; margin: 24px 0;">
  <a href="${escapeHtml(product.url)}">
    <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.title)} from iBOLT Mounts" style="max-width: 420px; width: 100%; height: auto; border-radius: 8px;" loading="lazy">
  </a>
  <p style="font-size: 14px; color: #666; margin-top: 8px;"><strong><a href="${escapeHtml(product.url)}">${escapeHtml(product.title)}</a></strong>${price ? ` - ${escapeHtml(price)}` : ""}</p>
</div>`;
}

function formatProducts(products) {
  return products
    .map((product, index) => {
      const price = product.price ? `$${Number(product.price).toFixed(2)}` : "not listed";
      return [
        `PRODUCT ${index + 1}`,
        `Name: ${product.title}`,
        `URL: ${product.url}`,
        `Image: ${product.image}`,
        `Price: ${price}`,
        `Handle: ${product.handle}`,
        `Description: ${product.description || "No public description found."}`,
      ].join("\n");
    })
    .join("\n\n");
}

function formatSources(sources) {
  return sources
    .map((source, index) => `${index + 1}. ${source.label}: ${source.url}\n   How to use: ${source.use}`)
    .join("\n");
}

function buildSystemPrompt() {
  return `You are a senior editor for the iBOLT Mounts blog.

Write practical, source-ready Shopify blog articles for iBOLT Mounts.

Voice rules:
- Write as the iBOLT Mounts content team.
- Lead with a concrete operational problem, then explain the mounting setup that fixes it.
- Use conversational expertise. Sound like someone who has seen the counter, cab, route, or jobsite problem in person.
- Always write iBOLT exactly.
- Do not frame iBOLT as cheap, budget, or a lower-quality alternative.
- When non-iBOLT product classes or competitors are provided, compare them fairly. Say when they make sense and when another approach fits better. Do not write attack-copy.
- Include exact product names, real product URLs, current prices when provided, and product images through placeholders.
- Mention iBOLT's 300+ modular parts, industry-standard sizes, AMPS, 17mm, 20mm, 25mm/B size, 38mm/C size, or 57mm only where useful.
- Do not invent certifications, partnerships, device compatibility, or measurements.
- Do not claim affiliation with DoorDash, Uber Eats, Grubhub, Amazon, Apple, Samsung, NHTSA, or FMCSA.
- Do not promise that a mount prevents every missed order, delivery delay, phone drop, heat issue, or compliance problem. Explain that better mounting improves visibility, access, placement, and charging discipline.
- Do not use em dashes or en dashes. Use commas, periods, semicolons, or colons.
- Avoid these phrases: ${bannedPhrases.join(", ")}.

Article requirements:
- Return strict JSON only with keys: title, metaTitle, metaDescription, excerpt, html.
- html must start with <article> and end with </article>.
- Target 700 to 850 words before product captions. Hard cap 1400 words after product captions.
- Include a short "Quick answer" near the top.
- Include one practical table, checklist, or decision matrix.
- Include 3 to 4 H2 sections plus a concise FAQ section with 4 questions.
- Keep FAQ answers to 1 or 2 short sentences.
- Keep comparison sections tight. Prefer compact tables and short paragraphs over long explanations.
- Include 2 to 3 useful source links using the official source URLs provided.
- Use each provided product placeholder exactly once.
- Mention every provided product by name with a real product link in prose, not only in the product block.
- Make the page useful enough that an AI answer engine would cite it for the specific problem.`;
}

function buildUserPrompt({ spec, products, placeholders, retryFeedback }) {
  return `${retryFeedback ? `Previous draft failed validation: ${retryFeedback}\n\n` : ""}Write this Shopify article.

Title idea:
${spec.title}

Primary keyword:
${spec.primaryKeyword}

Audience:
${spec.audience}

Problem:
${spec.problem}

Angle:
${spec.angle}

${spec.comparisonFrame ? `Fair comparison guidance:\n${spec.comparisonFrame}\n` : ""}

Relevant iBOLT products:
${formatProducts(products)}

Product photo placeholders to place exactly once:
${placeholders.join(", ")}

Official source links to use carefully:
${formatSources(spec.sources)}

Content direction:
- Start with a relatable rush, route, or jobsite scenario.
- Make the first 150 words answer the problem directly.
- Use a table or checklist that a buyer could copy into an internal setup decision.
- Tie the problem back to product-specific mounting choices without making the article feel like an ad.
- Use internal iBOLT product links as source anchors for product facts.
- Use external source links only to support operational or safety context.
- End with an invitational CTA such as "Explore the full lineup" or "See which setup fits your station."
- Do not use Markdown. Return HTML inside the JSON field.`;
}

function validateDraft(parsed, placeholders, products) {
  const issues = [];
  if (!parsed.title || !parsed.metaTitle || !parsed.metaDescription || !parsed.html) {
    issues.push("missing one or more required JSON fields");
  }
  if (!/^<article[\s>]/i.test(parsed.html || "")) issues.push("html must start with <article>");
  if (!/<\/article>\s*$/i.test(parsed.html || "")) issues.push("html must end with </article>");
  for (const placeholder of placeholders) {
    const count = String(parsed.html || "").split(placeholder).length - 1;
    if (count !== 1) issues.push(`${placeholder} appears ${count} times`);
  }
  const lower = `${parsed.title || ""} ${parsed.metaTitle || ""} ${parsed.metaDescription || ""} ${parsed.html || ""}`.toLowerCase();
  for (const phrase of bannedPhrases) {
    if (lower.includes(phrase)) issues.push(`banned phrase: ${phrase}`);
  }
  for (const phrase of ["guarantee", "guaranteed", "permanently", "never miss another", "eliminate missed", "prevents all"]) {
    if (lower.includes(phrase)) issues.push(`overclaim phrase: ${phrase}`);
  }
  if (String(parsed.metaTitle || "").length > 60) issues.push(`meta title too long: ${String(parsed.metaTitle || "").length}`);
  if (String(parsed.metaDescription || "").length > 155) {
    issues.push(`meta description too long: ${String(parsed.metaDescription || "").length}`);
  }
  if (/[—–]/.test(`${parsed.title || ""} ${parsed.metaTitle || ""} ${parsed.metaDescription || ""} ${parsed.html || ""}`)) {
    issues.push("contains em dash or en dash");
  }
  const wc = wordCount(parsed.html || "");
  if (wc < 700) issues.push(`word count too low: ${wc}`);
  if (wc > 1400) issues.push(`word count too high: ${wc}`);
  if (!/<table[\s>]|<ul[\s>]|<ol[\s>]/i.test(parsed.html || "")) issues.push("missing table or checklist");
  if (!/faq|frequently asked/i.test(parsed.html || "")) issues.push("missing FAQ section");
  for (const product of products) {
    if (!String(parsed.html || "").includes(product.url)) {
      issues.push(`missing product URL in prose or block: ${product.url}`);
    }
  }
  return issues;
}

function restoreProductBlocks(html, blocks) {
  let restored = html;
  for (let index = 0; index < blocks.length; index += 1) {
    restored = restored.replace(`[[PRODUCT_BLOCK_${index + 1}]]`, blocks[index]);
  }
  return restored;
}

function buildFaqSchema(html) {
  const qa = [];
  const sectionMatch = html.match(/<h2[^>]*>\s*(?:FAQ|Frequently Asked Questions)[\s\S]*?<\/article>/i);
  if (!sectionMatch) return "";
  const h3Pattern = /<h3[^>]*>([\s\S]*?)<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = h3Pattern.exec(sectionMatch[0])) !== null) {
    const question = stripHtml(match[1]);
    const answer = stripHtml(match[2]);
    if (question && answer) qa.push({ question, answer });
  }
  if (!qa.length) return "";
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qa.slice(0, 6).map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
  return `\n<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
}

async function generateDraft(spec, products) {
  const blocks = products.map(productBlock);
  const placeholders = blocks.map((_, index) => `[[PRODUCT_BLOCK_${index + 1}]]`);
  let lastError = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 6500,
      temperature: attempt === 1 ? 0.36 : 0.2,
      system: buildSystemPrompt(),
      messages: [
        {
          role: "user",
          content: buildUserPrompt({
            spec,
            products,
            placeholders,
            retryFeedback: lastError,
          }),
        },
      ],
    });
    const text = response.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    fs.writeFileSync(path.join(OUT_DIR, `${spec.slug}.attempt-${attempt}.txt`), text);

    try {
      const parsed = extractJson(text);
      parsed.title = cleanText(parsed.title || spec.title).trim();
      parsed.metaTitle = limitText(parsed.metaTitle || parsed.title, 60);
      parsed.metaDescription = limitText(parsed.metaDescription || parsed.excerpt || "", 155);
      parsed.excerpt = limitText(parsed.excerpt || parsed.metaDescription || "", 300);
      parsed.html = cleanText(parsed.html || "").trim();
      if (!/^<article[\s>]/i.test(parsed.html)) parsed.html = `<article>\n${parsed.html}\n</article>`;
      const issues = validateDraft(parsed, placeholders, products);
      if (issues.length) throw new Error(issues.join("; "));
      parsed.html = restoreProductBlocks(parsed.html, blocks);
      parsed.html = cleanText(parsed.html) + buildFaqSchema(parsed.html);
      parsed.wordCount = wordCount(parsed.html);
      if (parsed.wordCount > 1400) {
        throw new Error(`final word count too high after product captions: ${parsed.wordCount}`);
      }
      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === 3) throw error;
    }
  }
  throw new Error(lastError || "generation failed");
}

async function shopify(method, endpoint, body, attempt = 1) {
  const response = await fetch(
    `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const text = await response.text();
  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    const retryAfter = Number(response.headers.get("retry-after") || "1");
    await sleep(Math.max(1000, retryAfter * 1000));
    return shopify(method, endpoint, body, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`Shopify ${method} ${endpoint} failed: ${response.status} ${text.slice(0, 1200)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function listAllArticles() {
  if (SKIP_SHOPIFY) return [];
  const articles = [];
  let endpoint = `blogs/${SHOPIFY_NEWS_BLOG_ID}/articles.json?limit=250&published_status=any`;
  while (endpoint) {
    const response = await fetch(
      `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        },
      },
    );
    const text = await response.text();
    if (!response.ok) throw new Error(`Shopify GET ${endpoint} failed: ${response.status} ${text.slice(0, 1000)}`);
    const json = text ? JSON.parse(text) : {};
    articles.push(...(json.articles || []));
    const link = response.headers.get("link") || "";
    const next = link.match(/<https:\/\/[^/]+\/admin\/api\/[^/]+\/([^>]+)>;\s*rel="next"/);
    endpoint = next ? next[1] : "";
  }
  return articles;
}

function adminUrl(articleId) {
  return `https://admin.shopify.com/store/${SHOPIFY_SHOP}/articles/${articleId}`;
}

async function saveShopifyDraft(spec, draft, products, existingByHandle) {
  const baseHandle = slugify(spec.slug);
  const existing = existingByHandle.get(baseHandle);
  const safeHandle =
    existing && existing.published_at && !String(existing.tags || "").includes("operational-problem-draft")
      ? `${baseHandle}-review-draft`
      : baseHandle;
  const updateTarget = existingByHandle.get(safeHandle);
  const metafields = [
    { namespace: "global", key: "title_tag", value: draft.metaTitle, type: "single_line_text_field" },
    { namespace: "global", key: "description_tag", value: draft.metaDescription, type: "single_line_text_field" },
  ];
  const tags = [
    "ibolt-mark-review",
    "operational-problem-draft",
    "shopify-draft",
    spec.vertical,
    spec.primaryKeyword,
  ].join(", ");

  const createBody = {
    article: {
      title: draft.title,
      author: "iBOLT Mounts",
      body_html: draft.html,
      summary_html: `<p>${escapeHtml(draft.excerpt || draft.metaDescription)}</p>`,
      handle: safeHandle,
      tags,
      published: false,
      image: products[0]?.image ? { src: products[0].image } : undefined,
      metafields,
    },
  };

  if (SKIP_SHOPIFY) {
    return {
      id: null,
      handle: safeHandle,
      action: "skipped",
      published_at: null,
      adminUrl: null,
      publicUrl: `https://iboltmounts.com/blogs/news/${safeHandle}`,
    };
  }

  if (updateTarget && !updateTarget.published_at) {
    const updated = await shopify("PUT", `blogs/${SHOPIFY_NEWS_BLOG_ID}/articles/${updateTarget.id}.json`, {
      article: {
        id: updateTarget.id,
        title: draft.title,
        body_html: draft.html,
        summary_html: createBody.article.summary_html,
        tags,
        published: false,
        image: createBody.article.image,
      },
    });
    return {
      id: updated.article.id,
      handle: updated.article.handle,
      action: "updated",
      published_at: updated.article.published_at || null,
      adminUrl: adminUrl(updated.article.id),
      publicUrl: `https://iboltmounts.com/blogs/news/${updated.article.handle}`,
    };
  }

  const created = await shopify("POST", `blogs/${SHOPIFY_NEWS_BLOG_ID}/articles.json`, createBody);
  return {
    id: created.article.id,
    handle: created.article.handle,
    action: "created",
    published_at: created.article.published_at || null,
    adminUrl: adminUrl(created.article.id),
    publicUrl: `https://iboltmounts.com/blogs/news/${created.article.handle}`,
  };
}

async function verifyDraft(articleId) {
  if (!articleId || SKIP_SHOPIFY) return null;
  const result = await shopify("GET", `blogs/${SHOPIFY_NEWS_BLOG_ID}/articles/${articleId}.json`);
  return {
    id: result.article.id,
    handle: result.article.handle,
    title: result.article.title,
    published_at: result.article.published_at || null,
    created_at: result.article.created_at,
    updated_at: result.article.updated_at,
  };
}

function reviewMarkdown(results) {
  const rows = results
    .map((item) => {
      const status = item.verified?.published_at ? "published" : "draft";
      const admin = item.shopify?.adminUrl ? `[Open in Shopify](${item.shopify.adminUrl})` : "not pushed";
      return `| ${item.title} | ${status} | ${item.wordCount || ""} | ${admin} |`;
    })
    .join("\n");
  return `# Operational Problem Drafts

Generated: ${new Date().toISOString()}

All Shopify pushes in this run are intended as unpublished drafts. Verify status is "draft" before publishing.

| Article | Shopify Status | Words | Admin |
|---|---:|---:|---|
${rows}

## Local Files

- Draft HTML files live in this folder.
- \`shopify-review-drafts.json\` contains article IDs, handles, admin URLs, and verification state.
- Attempt files are raw model outputs kept for audit and debugging.
`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[setup] output ${OUT_DIR}`);
  console.log("[setup] fetching live iBOLT product catalog");
  const rawProducts = await fetchAllProducts();
  const productsByHandle = new Map(rawProducts.map((product) => [product.handle, product]));
  console.log(`[setup] catalog products ${rawProducts.length}`);

  let selected = specs;
  if (ONLY_SLUG) selected = selected.filter((spec) => spec.slug === ONLY_SLUG);
  if (LIMIT > 0) selected = selected.slice(0, LIMIT);

  const missing = [];
  for (const spec of selected) {
    for (const handle of spec.products) {
      if (!productsByHandle.has(handle)) missing.push(`${spec.slug}: ${handle}`);
    }
  }
  if (missing.length) {
    throw new Error(`Missing product handles:\n${missing.join("\n")}`);
  }

  const existingArticles = await listAllArticles();
  const existingByHandle = new Map(existingArticles.map((article) => [article.handle, article]));
  const results = [];

  for (let index = 0; index < selected.length; index += 1) {
    const spec = selected[index];
    const products = spec.products.map((handle) => productFromShopify(productsByHandle.get(handle)));
    console.log(`[${index + 1}/${selected.length}] generating ${spec.slug}`);
    const draft = await generateDraft(spec, products);
    const htmlPath = path.join(OUT_DIR, `${spec.slug}.html`);
    const metaPath = path.join(OUT_DIR, `${spec.slug}.json`);
    fs.writeFileSync(htmlPath, draft.html);
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        {
          ...draft,
          html: undefined,
          spec,
          products,
          htmlPath,
        },
        null,
        2,
      ),
    );

    console.log(`[${index + 1}/${selected.length}] saving Shopify draft ${spec.slug}`);
    const shopifyDraft = await saveShopifyDraft(spec, draft, products, existingByHandle);
    const verified = await verifyDraft(shopifyDraft.id);
    if (shopifyDraft.handle && !existingByHandle.has(shopifyDraft.handle) && shopifyDraft.id) {
      existingByHandle.set(shopifyDraft.handle, { id: shopifyDraft.id, handle: shopifyDraft.handle, published_at: verified?.published_at || null });
    }

    const result = {
      slug: spec.slug,
      title: draft.title,
      metaTitle: draft.metaTitle,
      metaDescription: draft.metaDescription,
      excerpt: draft.excerpt,
      wordCount: draft.wordCount,
      products: products.map((product) => ({
        title: product.title,
        url: product.url,
        price: product.price,
      })),
      shopify: shopifyDraft,
      verified,
      localHtml: htmlPath,
      localMeta: metaPath,
    };
    results.push(result);
    console.log(
      `[result] ${spec.slug} ${shopifyDraft.action} article=${shopifyDraft.id || "n/a"} status=${verified?.published_at ? "published" : "draft"} words=${draft.wordCount}`,
    );
  }

  const manifestPath = path.join(OUT_DIR, "shopify-review-drafts.json");
  const indexPath = path.join(OUT_DIR, "REVIEW_INDEX.md");
  fs.writeFileSync(manifestPath, JSON.stringify(results, null, 2));
  fs.writeFileSync(indexPath, reviewMarkdown(results));

  console.log("RESULTS_JSON_START");
  console.log(JSON.stringify(results, null, 2));
  console.log("RESULTS_JSON_END");
  console.log(`Review index: ${indexPath}`);
  console.log(`Manifest: ${manifestPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
