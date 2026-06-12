#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.resolve("content-output/seo-review-package-2026-06-10");
const SITE = "https://iboltmounts.com";

const forbiddenPhrases = [
  "game-changer",
  "revolutionize",
  "seamless",
  "cutting-edge",
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
  "cheaper than ram",
  "cost-effective alternative",
  "economical choice",
  "what ai search systems need to understand",
  "why this page is built for ai search",
];

const products = {
  metalAmps: {
    title: "iBOLT TabDock Bizmount Metal AMPS",
    handle: "ibolt-tabdock-bizmount-metal-amps",
    url: `${SITE}/products/ibolt-tabdock-bizmount-metal-amps`,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-tabdock-ibolt-tabdock-bizmount-metal-amps-1050407958.jpg?v=1768847890",
    price: "39.95",
    variantId: "50140592341284",
    sku: "IBBZ-33959",
    type: "Tablet AMPS Drill Base Mount",
  },
  incrediboltAmps: {
    title: "iBOLT TabDock IncrediBOLT AMPS 4.25 Inch Drill Base",
    handle: "ibolt-tabdock-dynamount-amps-w-4-25-dual-socket-arm-drill-base",
    url: `${SITE}/products/ibolt-tabdock-dynamount-amps-w-4-25-dual-socket-arm-drill-base`,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-tabdock-ibolt-tabdock-incredibolt-amps-w-4-25-dual-socket-arm-drill-base-1050408105.jpg?v=1768840630",
    price: "54.95",
    variantId: "50140640149796",
    sku: "IBDY-34332",
    type: "Tablet AMPS Drill Base Mount",
  },
  towerWall4: {
    title: "iBOLT Tablet Tower POS Wall Mount with 4 Tablet Holders",
    handle: "ibolt-tabdock-point-of-purchase-pos-wall-mount-with-4-tablet-holders",
    url: `${SITE}/products/ibolt-tabdock-point-of-purchase-pos-wall-mount-with-4-tablet-holders`,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-tabdock-ibolt-tablet-tower-tabdock-pos-wall-mount-with-4-tablet-holders-1050408318.jpg?v=1768885753",
    price: "134.95",
    variantId: "50140750119204",
    sku: "IBRT-34709",
    type: "Restaurant Multi-Tablet Wall Mount",
  },
  towerClamp5: {
    title: "iBOLT Tablet Tower POS Clamp Mount with 5 Tablet Holders",
    handle: "multi-tablet-stand-five-holders-restaurant-point-of-sale-purchase-ipad-ibrt-34706",
    url: `${SITE}/products/multi-tablet-stand-five-holders-restaurant-point-of-sale-purchase-ipad-ibrt-34706`,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-tabdock-ibolt-tablet-tower-tabdock-pos-clamp-mount-with-5-tablet-holders-1050408293.jpg?v=1768885690",
    price: "99.95",
    variantId: "50140732719396",
    sku: "IBRT-34706",
    type: "Restaurant Multi-Tablet Clamp Mount",
  },
  towerClamp3: {
    title: "iBOLT Tablet Tower POS Clamp Mount with 3 Tablet Holders",
    handle: "tablet-tower-multi-tablet-stand-ipad-point-of-sale-purchase-restaurant-triple-ibrt-34700",
    url: `${SITE}/products/tablet-tower-multi-tablet-stand-ipad-point-of-sale-purchase-restaurant-triple-ibrt-34700`,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-tabdock-ibolt-tablet-tower-tabdock-pos-clamp-mount-with-3-tablet-holders-1050408260.jpg?v=1768848789",
    price: "79.95",
    variantId: "50140722495780",
    sku: "IBRT-34700",
    type: "Restaurant Multi-Tablet Clamp Mount",
  },
  lockProSeatRail: {
    title: "iBOLT LockPro FlexPro Heavy Duty Locking Tablet Seat Rail Mount",
    handle: "ibolt-lockpro-flexpro-heavy-duty-locking-tablet-seat-rail-mount",
    url: `${SITE}/products/ibolt-lockpro-flexpro-heavy-duty-locking-tablet-seat-rail-mount`,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/files/ibolt-mounts-ibolt-lockpro-flexpro-heavy-duty-locking-tablet-seat-rail-mount-1194270682.jpg?v=1768829170",
    price: "159.95",
    variantId: "51110115377444",
    sku: "LOCKPRO-SEATRAIL",
    type: "Fleet ELD Tablet Mount",
  },
  tabdockFlexPro: {
    title: "iBOLT TabDock FlexPro Seat Rail Tablet ELD Mount",
    handle: "ibolt-tabdock-flexpro-heavy-duty-seat-rail-gooseneck-tablet-eld-floor-mount-ibbz-33762",
    url: `${SITE}/products/ibolt-tabdock-flexpro-heavy-duty-seat-rail-gooseneck-tablet-eld-floor-mount-ibbz-33762`,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-tabdock-ibolt-tabdock-flexpro-heavy-duty-seat-rail-gooseneck-tablet-eld-floor-mount-1050408777.jpg?v=1768864930",
    price: "34.95",
    variantId: "50140630581540",
    sku: "IBBZ-33762",
    type: "Fleet ELD Tablet Mount",
  },
  streamCastKit: {
    title: "iBOLT Stream-Cast Creator Custom Mount Kit",
    handle: "ibolt-stream-cast-creator-custom-mount-kit-with-over-60-variations-live-streaming-tutorial-videos-ibsc-34615",
    url: `${SITE}/products/ibolt-stream-cast-creator-custom-mount-kit-with-over-60-variations-live-streaming-tutorial-videos-ibsc-34615`,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-stream-cast-creator-custom-mount-kit-with-over-60-variations-great-for-live-streaming-tutorial-videos-and-photos-1050407750.jpg?v=1768845551",
    price: "139.95",
    variantId: "47014797181220",
    sku: "IBSC-34615",
    type: "Live Streaming Phone Mount",
  },
  streamCastStand: {
    title: "iBOLT Stream-Cast sPro2 Phone Stand",
    handle: "ibolt-stream-cast-spro2-phone-stand-weighted-base-mount-for-live-streaming-distance-learning-ibsc-34611",
    url: `${SITE}/products/ibolt-stream-cast-spro2-phone-stand-weighted-base-mount-for-live-streaming-distance-learning-ibsc-34611`,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-stream-cast-spro2-phone-stand-weighted-base-mount-1050407865.jpg?v=1768847170",
    price: "59.95",
    variantId: "47014794330404",
    sku: "IBSC-34611",
    type: "Live Streaming Phone Stand",
  },
  clampBase: {
    title: "iBOLT Clamp Base for 4-Hole AMPS Mounts",
    handle: "ibolt-clamp-base-for-4-hole-amps-mounts",
    url: `${SITE}/products/ibolt-clamp-base-for-4-hole-amps-mounts`,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/files/ibolt-mounts-ibolt-clamp-base-for-4-hole-amps-mounts-1184305715.jpg?v=1768825330",
    price: "24.95",
    variantId: "50983084392740",
    sku: "AMPS-CLAMP",
    type: "AMPS Clamp Base",
  },
  metal25AmpsPlate: {
    title: "iBOLT 25mm 1 Inch Metal AMPS Adapter Plate",
    handle: "25mm-1-inch-b-size-metal-amps-pattern-adapter-plate-ibpb-33890",
    url: `${SITE}/products/25mm-1-inch-b-size-metal-amps-pattern-adapter-plate-ibpb-33890`,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-25mm-1-inch-metal-amps-adapter-plate-1050406880.jpg?v=1768893670",
    price: "12.95",
    variantId: "47014777094436",
    sku: "IBPB-33890",
    type: "AMPS Adapter Plate",
  },
  motoViseClamp: {
    title: "iBOLT Moto-Vise Bizmount Clamp Phone Mount",
    handle: "ibolt-moto-vise-bizmount-clamp-heavy-duty-phone-claw-clamp-motorcycle-excercise-equipment-ibmc-34700",
    url: `${SITE}/products/ibolt-moto-vise-bizmount-clamp-heavy-duty-phone-claw-clamp-motorcycle-excercise-equipment-ibmc-34700`,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-moto-vise-bizmount-clamp-heavy-duty-smartphone-clamp-claw-mount-1050407487.jpg?v=1768849752",
    price: "49.95",
    variantId: "47014788464932",
    sku: "IBMC-34700",
    type: "Phone Clamp Mount",
  },
  forkliftPillar: {
    title: "Metal Forklift Pillar Bracket Mount",
    handle: "heavy-duty-metal-forklift-pillar-bracket-amps-pattern-ibfl-34500",
    url: `${SITE}/products/heavy-duty-metal-forklift-pillar-bracket-amps-pattern-ibfl-34500`,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/files/ibolt-mounts-metal-forklift-pillar-bracket-mount-1050410442.jpg?v=1768915389",
    price: "39.95",
    variantId: "47014819594532",
    sku: "IBFL-34500",
    type: "Forklift AMPS Bracket",
  },
};

const productDrafts = [
  {
    id: "product-tabdock-bizmount-metal-amps",
    targetType: "product",
    sourceUrl: products.metalAmps.url,
    product: products.metalAmps,
    metaTitle: "AMPS Tablet Mount for Trucks | iBOLT",
    metaDescription:
      "Mount 7 to 11 inch tablets on AMPS brackets in trucks, vans, carts, and workstations with the iBOLT TabDock Bizmount Metal AMPS.",
    recommendedProductType: "Tablet AMPS Drill Base Mount",
    recommendedTags: ["AMPS", "tablet mount", "ELD", "truck mount", "drill base"],
    body: `
<p>The iBOLT TabDock Bizmount Metal AMPS is built for drivers, fleet managers, installers, and mobile workers who need a fixed tablet position instead of a loose device sliding around the cab. It pairs a universal TabDock tablet holder with a metal AMPS mounting base so the tablet can be installed on vehicle-specific AMPS brackets, flat work surfaces, carts, consoles, and other drill-base locations.</p>
<p>This is a practical fit for ELD tablets, dispatch screens, route navigation, inspection apps, inventory workflows, and service vehicles where the device needs to stay visible but out of the driver's hands. The holder is designed for common 7 to 11 inch tablets, including iPad, Samsung Galaxy Tab, and similar Android tablets, with four contact points to keep the device steady during daily use.</p>
<p>The AMPS pattern matters because it gives installers a known standard. Instead of replacing an entire mounting setup when the vehicle or tablet changes, teams can reuse compatible iBOLT arms, brackets, adapter plates, and other 25mm or AMPS parts from the larger modular system. That helps keep fleet installs consistent across different trucks, vans, and workstations.</p>
<ul>
  <li>Best use: ELD tablets, work trucks, vans, carts, and fixed workstation installs.</li>
  <li>Mounting style: metal AMPS base for permanent or semi-permanent placement.</li>
  <li>Device fit: most 7 to 11 inch tablets with or without common protective cases.</li>
  <li>Install note: confirm screw clearance, cable path, and sightline before drilling.</li>
</ul>`,
    faqs: [
      {
        q: "What is this AMPS tablet mount best used for?",
        a: "It is best for fixed tablet installs in work trucks, vans, carts, and commercial workstations where a 7 to 11 inch tablet needs a secure viewing position.",
      },
      {
        q: "Does it work for ELD tablets?",
        a: "Yes. The AMPS drill-base layout is a strong fit for ELD tablets because it keeps the screen visible and stable while the vehicle is in service.",
      },
      {
        q: "Can I use this with other iBOLT mounting parts?",
        a: "Yes. The AMPS pattern and iBOLT modular parts make it easier to combine this holder with compatible brackets, arms, and adapter plates.",
      },
      {
        q: "Should this be installed permanently?",
        a: "Use it when a fixed install makes sense. Test the sightline, reach, and cable routing before drilling into a vehicle, counter, cart, or wall.",
      },
    ],
  },
  {
    id: "product-tabdock-incredibolt-amps-425",
    targetType: "product",
    sourceUrl: products.incrediboltAmps.url,
    product: products.incrediboltAmps,
    metaTitle: "ELD Tablet Drill Base Mount | iBOLT",
    metaDescription:
      "Secure an ELD, dispatch, or fleet tablet with an AMPS drill-base mount, 4.25 inch arm, and universal 7 to 11 inch tablet holder.",
    recommendedProductType: "ELD Tablet Drill Base Mount",
    recommendedTags: ["ELD mount", "fleet tablet mount", "AMPS", "drill base", "tablet holder"],
    body: `
<p>The iBOLT TabDock IncrediBOLT AMPS with 4.25 inch dual socket arm is built for commercial vehicles and fixed workstations that need a tablet to stay in the same place shift after shift. The 4.25 inch arm gives more reach than a low-profile plate, while the AMPS drill base gives installers a stable mounting point on dashboards, consoles, walls, carts, or work surfaces.</p>
<p>For fleets, the value is consistency. A tablet used for ELD logs, dispatch, proof of delivery, route planning, or maintenance forms should be visible without blocking controls or the windshield. This mount gives the tablet a dedicated home, with adjustable viewing angles and a universal holder for most 7 to 11 inch tablets.</p>
<p>The AMPS layout also makes this mount useful beyond trucking. It can support tablet check-in stations, warehouse carts, field service vans, maintenance benches, and other work areas where the device needs to be secure but still easy to reach. The system connects into iBOLT's wider family of 25mm, 38mm, AMPS, and adapter parts for future changes.</p>
<ul>
  <li>Best use: ELD, dispatch, fleet, field service, and fixed tablet workflows.</li>
  <li>Arm length: 4.25 inch dual socket arm for adjustable tablet placement.</li>
  <li>Device fit: most 7 to 11 inch tablets in standard or rugged cases.</li>
  <li>Install note: place the screen where it supports quick glances without blocking vehicle controls.</li>
</ul>`,
    faqs: [
      {
        q: "Why choose a 4.25 inch arm instead of a shorter mount?",
        a: "The longer arm gives more placement control when the AMPS base is not directly beside the ideal tablet viewing position.",
      },
      {
        q: "Can this be used in commercial trucks?",
        a: "Yes. It is a strong fit for ELD and dispatch tablet setups in trucks, vans, and fleet vehicles when installed in a safe viewing location.",
      },
      {
        q: "What tablet sizes does the holder support?",
        a: "The TabDock holder is intended for most 7 to 11 inch tablets, including many iPad, Samsung Galaxy Tab, and Android tablet models.",
      },
      {
        q: "Does this connect to AMPS brackets?",
        a: "Yes. The AMPS pattern is designed for common vehicle brackets, adapter plates, and modular mounting parts.",
      },
    ],
  },
  {
    id: "product-tablet-tower-wall-4",
    targetType: "product",
    sourceUrl: products.towerWall4.url,
    product: products.towerWall4,
    metaTitle: "4 Tablet Restaurant Wall Mount | iBOLT",
    metaDescription:
      "Clear counter space and organize four delivery or POS tablets with the iBOLT Tablet Tower POS wall mount for restaurants and kitchens.",
    recommendedProductType: "Restaurant Multi-Tablet Wall Mount",
    recommendedTags: ["restaurant tablet mount", "multi tablet holder", "POS", "delivery apps", "wall mount"],
    body: `
<p>The iBOLT Tablet Tower POS Wall Mount with 4 Tablet Holders is made for restaurants that are out of counter space but not out of tablets. Delivery apps, POS tools, pickup systems, loyalty programs, and kitchen workflows often stack up on the expo line. Wall mounting keeps those screens visible without turning the counter into a charging pile.</p>
<p>The four-holder layout is a strong fit for ghost kitchens, quick-service restaurants, multi-brand kitchens, and busy takeout counters where staff need to see several order streams at once. Each holder supports 7 to 11 inch tablets and rotates for vertical or horizontal viewing, so the station can match the apps your staff actually use.</p>
<p>The wall format also helps with cleaning and consistency. Tablets stay in a defined station, cables can be routed more cleanly, and staff do not have to hunt for the DoorDash, Uber Eats, Grubhub, or house POS tablet during a rush. The kit includes the tablet holders, wall-mount hardware, extension pole, and mounting components needed for a professional setup.</p>
<ul>
  <li>Best use: restaurants, ghost kitchens, delivery app stations, kiosks, and retail counters.</li>
  <li>Capacity: four tablet holders in one wall-mounted station.</li>
  <li>Device fit: most 7 to 11 inch tablets.</li>
  <li>Install note: mount near power, but away from heat, splash zones, and narrow staff paths.</li>
</ul>`,
    faqs: [
      {
        q: "Why use a wall mount for restaurant tablets?",
        a: "A wall mount keeps tablets visible while freeing counter space for food, payments, bags, labels, and staff movement.",
      },
      {
        q: "Can this hold four delivery app tablets?",
        a: "Yes. It is designed for multi-tablet restaurant workflows, including several delivery platforms or a mix of POS and order apps.",
      },
      {
        q: "Will the holders rotate?",
        a: "Yes. Each tablet holder can be positioned for vertical or horizontal viewing based on the app layout and staff preference.",
      },
      {
        q: "Where should it be installed?",
        a: "Place it near the expo, pickup, or counter area where staff can see orders quickly, while keeping it away from heat and splash zones.",
      },
    ],
  },
  {
    id: "product-tablet-tower-clamp-5",
    targetType: "product",
    sourceUrl: products.towerClamp5.url,
    product: products.towerClamp5,
    metaTitle: "5 Tablet POS Clamp Mount | iBOLT",
    metaDescription:
      "Organize five restaurant delivery or POS tablets on one counter station with the iBOLT Tablet Tower clamp mount.",
    recommendedProductType: "Restaurant Multi-Tablet Clamp Mount",
    recommendedTags: ["restaurant tablet stand", "multiple tablet holder", "delivery tablets", "POS", "clamp mount"],
    body: `
<p>The iBOLT Tablet Tower POS Clamp Mount with 5 Tablet Holders is built for restaurants that run several tablet-based systems at the same time. Instead of spreading devices across the host stand, prep counter, or pickup shelf, this station puts up to five tablets in one organized footprint.</p>
<p>The clamp base is useful when drilling into a counter is not the first choice. It can attach to compatible flat surfaces up to 2.5 inches wide, while the included drill-base option gives operators a more permanent install path when the station becomes part of the kitchen workflow. Each holder supports 7 to 11 inch tablets and rotates for portrait or landscape app layouts.</p>
<p>This is a good fit for high-volume delivery, ghost kitchens, virtual brands, food halls, and restaurants that separate POS, delivery apps, and order management tools by screen. Staff can see incoming tickets faster, managers can keep devices assigned to a consistent spot, and charging can be planned around a single station instead of scattered cables.</p>
<ul>
  <li>Best use: five-tablet delivery app stations, POS counters, ghost kitchens, and virtual brands.</li>
  <li>Mounting style: clamp base for compatible counters, with drill-base option for fixed placement.</li>
  <li>Device fit: most 7 to 11 inch tablets.</li>
  <li>Install note: confirm counter thickness, cable path, and staff reach before placing the tower.</li>
</ul>`,
    faqs: [
      {
        q: "How many tablets does this restaurant tablet mount hold?",
        a: "This model holds up to five tablets, making it a strong fit for restaurants running several delivery apps or order systems.",
      },
      {
        q: "Does it require drilling?",
        a: "No. The clamp base can be used on compatible counters, and the drill-base option is available when a fixed station is preferred.",
      },
      {
        q: "What tablet sizes fit?",
        a: "The holders are intended for most 7 to 11 inch tablets, including common iPad, Samsung Galaxy Tab, and Android tablet sizes.",
      },
      {
        q: "Is this better than using several single stands?",
        a: "For multi-app restaurants, one organized tower usually saves space and makes it easier for staff to monitor every tablet during busy periods.",
      },
    ],
  },
];

const collectionDrafts = [
  {
    id: "collection-live-streaming",
    targetType: "collection",
    sourceUrl: `${SITE}/collections/live-streaming`,
    title: "Live Streaming Phone and Camera Mounts",
    metaTitle: "Live Streaming Phone Mounts | iBOLT",
    metaDescription:
      "Shop phone stands, overhead camera mounts, tripod adapters, and Stream-Cast rigs for creators, teachers, streamers, and demos.",
    products: [products.streamCastKit, products.streamCastStand, products.clampBase],
    body: `
<p>Live streaming mounts need to do more than hold a phone upright. A cooking demo, product unboxing, craft tutorial, classroom lesson, podcast clip, or repair bench video may need overhead angles, front-facing camera placement, a second device for chat, and room for lights or microphones. This collection focuses on phone stands, camera mounts, tripod adapters, and Stream-Cast setups that keep the recording angle repeatable.</p>
<p>Choose a weighted stand when the setup stays on a desk or counter. Choose an overhead clamp or drill-base rig when the camera needs to look straight down at hands, tools, products, food, or paperwork. Choose camera screw adapters and AMPS parts when you are building around an existing tripod, studio arm, cart, or workstation.</p>
<p>iBOLT's creator mounts are useful for TikTok, Instagram Reels, YouTube Shorts, Zoom training, distance learning, product demos, kitchen content, repair benches, and small studio workflows. Many pieces connect into iBOLT's broader modular system, so creators can change the arm, base, holder, or camera adapter without starting over.</p>`,
    faqs: [
      {
        q: "What is the best phone stand for live streaming?",
        a: "For desk streams, use a weighted phone stand. For top-down tutorials, use an overhead clamp, wall, ceiling, or camera rig that keeps the angle fixed.",
      },
      {
        q: "Can these mounts hold cameras too?",
        a: "Yes. Many iBOLT creator setups use 1/4-20 camera screw adapters for DSLR cameras, action cameras, small projectors, lights, or microphones.",
      },
      {
        q: "What is an overhead phone mount used for?",
        a: "It is used for cooking, crafts, unboxing, drawing, repairs, product demos, and any shot where the viewer needs to see the work surface.",
      },
      {
        q: "Do I need a clamp or weighted base?",
        a: "Use a clamp when the mount needs to attach to a desk edge or shelf. Use a weighted base when you want a movable station without clamping.",
      },
    ],
  },
  {
    id: "collection-top-eld-solutions",
    targetType: "collection",
    sourceUrl: `${SITE}/collections/top-eld-solutions`,
    title: "Fleet and ELD Tablet Mounting Systems",
    metaTitle: "Fleet and ELD Tablet Mounts | iBOLT",
    metaDescription:
      "Find ELD tablet mounts for trucks, vans, fleets, and commercial vehicles with AMPS, seat rail, suction, and locking options.",
    products: [products.lockProSeatRail, products.tabdockFlexPro, products.incrediboltAmps],
    body: `
<p>ELD tablets have become the main screen for logging, dispatch, routing, inspections, messaging, and fleet apps. The mount has to keep that screen visible without turning it into a loose device on the seat, dash, or cup holder. This collection brings together iBOLT tablet mounts for commercial trucks, vans, delivery vehicles, service fleets, and shared work vehicles.</p>
<p>Start with the vehicle and driver workflow. Seat rail mounts work well when you need a tablet near the center console without attaching to the windshield. AMPS drill-base mounts are better for fixed fleet installs, wall panels, consoles, and vehicle-specific brackets. Suction and cup holder mounts can help with temporary setups, personal vehicles, and mixed-use fleets. Locking tablet holders are useful when devices stay in the vehicle between shifts.</p>
<p>For fleet managers, standardizing on iBOLT's modular ball sizes and AMPS parts can make replacement easier across vehicle types. Drivers get a consistent tablet position, and installers get a repeatable mounting system for ELD, GPS, inspection, and communication devices.</p>`,
    faqs: [
      {
        q: "What is the best mount for an ELD tablet?",
        a: "The best ELD mount depends on the vehicle. Seat rail, AMPS drill-base, suction, and locking mounts all work, but the tablet must be visible and should not block controls or sightlines.",
      },
      {
        q: "Should fleet tablets use locking holders?",
        a: "Locking holders are recommended when tablets stay in shared vehicles, are assigned to crews, or need extra protection from theft and accidental removal.",
      },
      {
        q: "Do AMPS mounts work for commercial vehicles?",
        a: "Yes. AMPS is a common pattern for vehicle brackets, adapter plates, and installed tablet setups in commercial vehicles.",
      },
      {
        q: "Can one fleet use the same mounting system across different vehicles?",
        a: "Often, yes. Modular iBOLT arms, bases, holders, and adapter plates help teams keep similar tablet setups across trucks, vans, and service vehicles.",
      },
    ],
  },
  {
    id: "collection-20mm-ball-adapters",
    targetType: "collection",
    sourceUrl: `${SITE}/collections/20mm-ball-adapters-andmounts`,
    title: "20mm Ball Adapters and Mounts",
    metaTitle: "20mm Ball Adapters and Mounts | iBOLT",
    metaDescription:
      "Build or adapt 20mm mounting systems with iBOLT ball adapters, clamps, camera screw adapters, and modular mount parts.",
    products: [products.metal25AmpsPlate, products.clampBase, products.metalAmps],
    body: `
<p>20mm ball mounts sit between small phone mounts and larger 25mm or 38mm commercial systems. They are useful when you need compact adjustment for phones, GPS units, cameras, action cameras, light tablets, and specialty device holders. This collection should help shoppers understand whether they need a 20mm part, an AMPS adapter, a clamp base, or a larger ball size before they buy.</p>
<p>Use 20mm when the device is smaller and the install needs compact movement. Step up to 25mm or 38mm when the device is heavier, the arm is longer, or the environment has more vibration. AMPS plates and adapter parts are helpful when joining ball mounts to vehicle brackets, camera screws, tablet holders, magnetic bases, drill bases, or custom mounting surfaces.</p>
<p>iBOLT parts are designed around real mounting standards, not one closed kit. That matters for installers, fleet managers, creators, and equipment teams who need to replace a holder, change a base, or adapt a mount to a different device later.</p>`,
    faqs: [
      {
        q: "What is a 20mm ball mount used for?",
        a: "A 20mm ball mount is commonly used for compact phone, GPS, camera, and accessory mounting where the device does not need a larger 25mm or 38mm system.",
      },
      {
        q: "Is 20mm the same as a 1 inch ball?",
        a: "No. A 1 inch ball is about 25mm. Confirm the ball size before buying arms, adapters, or holders.",
      },
      {
        q: "When should I use AMPS adapter plates?",
        a: "Use AMPS adapter plates when you need to connect a holder, ball adapter, or arm to a standard 4-hole mounting pattern.",
      },
      {
        q: "Can iBOLT parts adapt to other mount systems?",
        a: "Many iBOLT parts use common ball sizes, AMPS patterns, and camera screw standards, which helps when building or updating mixed mounting setups.",
      },
    ],
  },
  {
    id: "collection-smartphone-phone-mounts",
    targetType: "collection",
    sourceUrl: `${SITE}/collections/smartphone-phone-mounts`,
    title: "Smartphone and Phone Mounts",
    metaTitle: "Phone Mounts for Work and Vehicles | iBOLT",
    metaDescription:
      "Shop iBOLT phone mounts for cars, trucks, fleets, delivery work, motorcycles, carts, counters, and fixed AMPS installs.",
    products: [products.motoViseClamp, products.clampBase, products.streamCastStand],
    body: `
<p>A phone mount for work has to match the job, not just the phone. Delivery drivers need quick visibility and one-hand access. Fleet managers may need the same phone position across several vehicles. Motorcycles, carts, counters, forklifts, and workstations may need clamp, AMPS, screw, ball, socket, suction, magnetic, or drill-base setups depending on the surface.</p>
<p>This collection should guide shoppers by mounting style first. Use a suction or cup holder setup for temporary vehicle placement. Use a clamp when the phone needs to attach to a handlebar, rail, pole, shelf, cart, or counter edge. Use an AMPS drill-base or adapter plate when the phone needs a fixed position in a commercial vehicle or workstation. Use a weighted stand for counters, livestreaming, video calls, or desk work.</p>
<p>iBOLT phone mounts are built around modular parts and common standards like 17mm, 20mm, 25mm, 38mm, AMPS, and 1/4-20 camera screw adapters. That makes the system useful when the phone holder changes, the vehicle changes, or the same setup needs to support another device later.</p>`,
    faqs: [
      {
        q: "What phone mount is best for delivery drivers?",
        a: "Delivery drivers usually need a mount that keeps the phone visible, easy to reach, and stable through repeated stops. Suction, cup holder, AMPS, or locking phone mounts can all fit depending on the vehicle.",
      },
      {
        q: "What is a phone clamp mount?",
        a: "A phone clamp mount attaches to a pole, rail, handlebar, cart, counter, or similar edge, making it useful when a dashboard or windshield mount is not ideal.",
      },
      {
        q: "When should I use an AMPS phone mount?",
        a: "Use an AMPS phone mount when you need a fixed install on a vehicle bracket, wall, desk, cart, or work surface.",
      },
      {
        q: "Can I reuse iBOLT parts if my phone changes?",
        a: "Often, yes. Many iBOLT holders, arms, adapters, and bases are modular, so you may only need to swap the holder or adapter.",
      },
    ],
  },
];

const articleDrafts = [
  {
    id: "article-managing-multiple-tablets-restaurant-refresh",
    targetType: "article_refresh",
    sourceUrl: `${SITE}/blogs/news/managing-multiple-tablets-in-a-restaurant`,
    title: "How to Manage Multiple Restaurant Tablets",
    metaTitle: "Multiple Restaurant Tablets: Setup Guide",
    metaDescription:
      "Learn how to organize POS and delivery tablets for restaurants with wall, clamp, and multi-tablet station options from iBOLT.",
    slug: "how-to-manage-multiple-restaurant-tablets",
    products: [products.towerClamp3, products.towerClamp5, products.towerWall4],
    body: `
<p>Most restaurant tablet problems do not start with the tablet. They start with the station. One screen is for DoorDash, another is for Uber Eats, another is for Grubhub, and the POS tablet is sitting somewhere between the receipt printer and the expo marker. During a slow hour, the setup looks manageable. During the dinner rush, it turns into missed orders, tangled charging cables, greasy screens, and staff asking which tablet made the sound.</p>
<p>A better multi-tablet setup gives every screen a defined place. The goal is not to make the counter look cleaner for photos. The goal is to help staff notice new orders faster, keep delivery platforms separated, protect hardware, and make charging predictable.</p>
<h2>Start with the workflow, not the device count</h2>
<p>Before choosing a multiple tablet holder, list the jobs each screen handles. A quick-service counter may only need a POS tablet and one delivery tablet. A ghost kitchen may need four or five delivery platforms visible at once. A full-service restaurant may need one station for pickup orders and another tablet near the host stand.</p>
<p>The best restaurant tablet mount is the one that matches the point in the workflow where staff make decisions. If tablets are used for accepting orders, they need to be visible near the person watching incoming tickets. If they are used for pickup coordination, they need to sit near bags, labels, or the expo line. If they are used for payment, security and customer-facing placement matter more.</p>
<h2>Use one station for delivery apps</h2>
<p>Multiple single-tablet stands take up more counter space than most restaurants expect. They also move around during cleaning, shift changes, and rush periods. A multi-tablet station keeps all screens in a consistent footprint and gives the team one place to check when an order alert comes in.</p>
${productCard(products.towerClamp3)}
<p>The <a href="${products.towerClamp3.url}">iBOLT Tablet Tower POS Clamp Mount with 3 Tablet Holders</a> is a strong starting point for restaurants running three delivery apps or a delivery plus POS mix. For higher-volume operations, the <a href="${products.towerClamp5.url}">5-tablet clamp mount</a> gives more room without spreading devices across the counter.</p>
${productCard(products.towerClamp5)}
<h2>Move tablets to the wall when counter space is gone</h2>
<p>If the counter is already packed with bags, labels, printers, payment hardware, and prep tools, a wall-mounted tablet station may be cleaner. Wall placement keeps tablets at eye level, helps route charging cables away from food prep areas, and makes the station feel like part of the kitchen instead of a temporary pile of devices.</p>
${productCard(products.towerWall4)}
<p>The <a href="${products.towerWall4.url}">iBOLT Tablet Tower POS Wall Mount with 4 Tablet Holders</a> is built for restaurants that want the tablets visible but off the work surface. It works especially well near pickup shelves, expo lines, or back-of-house order stations, as long as the wall location is away from heat and splash zones.</p>
<h2>Plan charging, cleaning, and tablet ownership</h2>
<p>A restaurant tablet station should be easy to clean around, easy to charge, and easy to understand during shift changes. Label the holder positions if each tablet belongs to a platform. Keep cables routed behind the station or along the wall. Do not place tablets where staff have to reach across hot equipment or wet counters.</p>
<p>For customer-facing tablets, add locking holders or a fixed drill-base stand. For back-of-house delivery app tablets, visibility and organization usually matter first. If devices are shared across shifts or left unattended, security should move higher on the list.</p>
<h2>Recommended setup by restaurant type</h2>
<ul>
  <li><strong>Small takeout counter:</strong> one POS tablet plus one delivery tablet on separate secure stands.</li>
  <li><strong>Full-service restaurant:</strong> a 3-tablet tower for delivery apps plus a separate POS stand at checkout.</li>
  <li><strong>Ghost kitchen:</strong> a 4 or 5-tablet station where all delivery platforms stay visible.</li>
  <li><strong>Food truck:</strong> a compact clamp, suction, or locking stand that can be removed or secured at close.</li>
  <li><strong>High-volume pickup area:</strong> a wall-mounted tablet station close to bags, shelves, and labels.</li>
</ul>
<h2>Frequently Asked Questions</h2>
${faqHtml([
      {
        q: "How many tablets should a restaurant delivery station hold?",
        a: "Most restaurants need one holder per active platform, plus room for POS or pickup apps if they run in the same station. Three holders is a common starting point, while ghost kitchens often need four or five.",
      },
      {
        q: "Is a wall mount better than a counter stand?",
        a: "A wall mount is better when counter space is tight or tablets need to stay at eye level. A clamp or counter stand is better when the setup may move or when drilling is not allowed.",
      },
      {
        q: "Can one tablet tower hold iPads and Android tablets?",
        a: "Yes, iBOLT Tablet Tower holders are designed for common 7 to 11 inch tablets, including iPads, Samsung Galaxy Tabs, and similar Android tablets.",
      },
      {
        q: "Should restaurant tablets be locked?",
        a: "Locking holders are best for customer-facing or unattended tablets. Back-of-house delivery app tablets may not need locks, but they still need stable placement.",
      },
      {
        q: "Where should charging cables go?",
        a: "Route cables behind the station or along the wall, away from food prep areas, walk paths, heat, and cleaning spray.",
      },
    ])}
<p>A multi-tablet setup should make the rush easier to manage. Start with the workflow, choose the base that fits the counter or wall, and give every delivery platform a visible home.</p>`,
  },
  {
    id: "article-eld-mandate-refresh",
    targetType: "article_refresh",
    sourceUrl: `${SITE}/blogs/news/confused-about-the-eld-mandate`,
    title: "ELD Tablet Mounting Guide for Fleets",
    metaTitle: "ELD Tablet Mounting Guide for Fleets",
    metaDescription:
      "A practical guide to ELD tablet mounting for trucks, vans, and fleets, with AMPS, seat rail, suction, and locking options.",
    slug: "eld-tablet-mounting-guide-for-fleets",
    products: [products.lockProSeatRail, products.incrediboltAmps, products.tabdockFlexPro],
    body: `
<p>The ELD mandate made tablets part of daily work for many commercial drivers. The tablet is no longer just a navigation screen. It may handle hours of service, inspections, dispatch messages, proof of delivery, route updates, and fleet communication. When that tablet sits loose on the passenger seat or slides around the dashboard, the mount becomes a safety and productivity issue.</p>
<p>A good ELD tablet mount gives the driver a consistent viewing position without blocking the windshield, controls, gauges, airbags, or mirrors. It also gives the fleet a repeatable installation standard so vehicles do not become a mix of random holders and improvised brackets.</p>
<h2>What the mount needs to do</h2>
<p>ELD tablets need to be visible at a glance and reachable when parked or safely stopped. They should not force drivers to hold the device, search the cab for it, or fight a loose charging cable. The mount also has to deal with vibration, heat, long shifts, shared vehicles, and tablets in protective cases.</p>
<p>The right base depends on the vehicle. Seat rail mounts are useful when the tablet needs to sit near the center console. AMPS drill-base mounts are useful for permanent fleet installs and vehicle-specific brackets. Suction mounts can work for temporary setups, but fleets should test heat, surface texture, and maintenance requirements before standardizing on suction.</p>
<h2>Seat rail mounts for trucks and vans</h2>
${productCard(products.lockProSeatRail)}
<p>The <a href="${products.lockProSeatRail.url}">iBOLT LockPro FlexPro locking tablet seat rail mount</a> is a strong fit when the tablet should sit near the driver without attaching to the windshield. The locking holder helps shared fleets keep the assigned tablet in place, and the seat rail position can reduce dashboard clutter.</p>
<p>Seat rail installs still need careful placement. The tablet should not interfere with seat movement, passenger space, shifting, cup holders, or emergency controls. Test the viewing angle from the actual driving position before final tightening.</p>
<h2>AMPS drill-base mounts for fixed installs</h2>
${productCard(products.incrediboltAmps)}
<p>For fleets that want a more permanent setup, the <a href="${products.incrediboltAmps.url}">iBOLT TabDock IncrediBOLT AMPS 4.25 inch drill-base mount</a> gives installers a known AMPS mounting pattern and an adjustable arm. AMPS is useful because it connects to many vehicle brackets, adapter plates, and modular iBOLT parts.</p>
<p>AMPS mounts work well when a fleet wants the same tablet placement across similar vehicles. They are also a good choice for service vans, utility trucks, dispatch desks, and warehouse carts where a fixed screen position is useful.</p>
<h2>Lower-profile ELD mounting</h2>
${productCard(products.tabdockFlexPro)}
<p>The <a href="${products.tabdockFlexPro.url}">iBOLT TabDock FlexPro seat rail tablet ELD mount</a> is useful when the install needs a practical seat rail position with a simpler tablet holder. It can help fleets avoid windshield clutter while keeping the tablet close enough for parked interactions.</p>
<h2>Fleet install checklist</h2>
<ul>
  <li>Confirm the tablet size with its protective case installed.</li>
  <li>Choose the base type by vehicle ownership, not just preference.</li>
  <li>Keep the tablet visible without blocking the road, gauges, controls, or airbags.</li>
  <li>Plan charging cable routing before drilling or tightening the mount.</li>
  <li>Use locking holders when tablets stay in shared vehicles.</li>
  <li>Document the standard setup so replacement parts are easy to order.</li>
</ul>
<h2>Frequently Asked Questions</h2>
${faqHtml([
      {
        q: "Does the ELD mandate require a specific tablet mount?",
        a: "The mandate does not require one specific mount brand or style, but fleets still need a secure and practical tablet position for safe use and consistent operation.",
      },
      {
        q: "What is the best ELD tablet mount for a semi truck?",
        a: "Seat rail and AMPS drill-base mounts are common choices. The best option depends on the cab layout, tablet size, driver reach, and whether the install needs to be permanent.",
      },
      {
        q: "Should ELD tablets be mounted on the windshield?",
        a: "Only if the mount and local rules allow a safe placement that does not block the driver's view. Many fleets prefer seat rail, AMPS, or dash bracket installs.",
      },
      {
        q: "Why use a locking tablet holder?",
        a: "A locking holder helps protect shared fleet tablets, reduces accidental removal, and keeps the device assigned to the vehicle or route.",
      },
      {
        q: "Can the same mount support dispatch and navigation apps?",
        a: "Yes. The mount holds the tablet, and the tablet can run ELD, dispatch, routing, inspection, and other fleet apps as needed.",
      },
    ])}
<p>For most fleets, the mount is part of the ELD system. Standardize the tablet, holder, base, cable path, and installation notes so every driver gets a consistent setup.</p>`,
  },
  {
    id: "article-clamping-phone-tablet-mounts-refresh",
    targetType: "article_refresh",
    sourceUrl: `${SITE}/blogs/news/great-places-to-use-clamping-tablet-and-phone-mounts`,
    title: "Where to Use Clamp Phone and Tablet Mounts",
    metaTitle: "Clamp Phone and Tablet Mount Guide",
    metaDescription:
      "See when to use clamp mounts for phones, tablets, cameras, AMPS plates, carts, counters, poles, rails, and workstations.",
    slug: "clamp-phone-tablet-mount-guide",
    products: [products.clampBase, products.motoViseClamp, products.forkliftPillar],
    body: `
<p>Clamp mounts solve a very specific problem: there is a good place to attach the device, but it is not a windshield, cup holder, or flat wall. A clamp can turn a pole, rail, shelf, counter edge, cart, handlebar, forklift pillar, or workstation into a phone, tablet, camera, or AMPS mounting point.</p>
<p>The key is choosing the clamp by the surface, the device weight, and the amount of vibration. A light phone on a desk edge is different from a tablet on a warehouse cart or a scanner setup near a forklift operator. The clamp needs to fit the surface securely, and the rest of the mount needs to match the device.</p>
<h2>Clamp bases for AMPS systems</h2>
${productCard(products.clampBase)}
<p>The <a href="${products.clampBase.url}">iBOLT Clamp Base for 4-Hole AMPS Mounts</a> is useful when you already want to build around AMPS plates, arms, and holders. It can create a non-drill mounting point on desks, counters, shelves, carts, and some workstations. From there, an installer can add a compatible AMPS adapter, phone holder, tablet holder, or specialty device mount.</p>
<p>This is helpful for restaurants, retail counters, repair benches, labs, warehouses, trade show booths, and shared work areas where a fixed install may not be allowed.</p>
<h2>Phone clamp mounts for poles, rails, and handlebars</h2>
${productCard(products.motoViseClamp)}
<p>The <a href="${products.motoViseClamp.url}">iBOLT Moto-Vise Bizmount Clamp Phone Mount</a> is built for phone placement on rails, handlebars, posts, and other clamp-friendly surfaces. That makes it useful for motorcycles, carts, fitness equipment, work benches, light industrial setups, and outdoor equipment where a flat mounting surface is not available.</p>
<p>Before choosing a phone clamp, measure the rail or pole diameter, confirm the holder fits the phone with its case, and check whether the phone needs to rotate between portrait and landscape.</p>
<h2>When a clamp mount is the wrong choice</h2>
<p>A clamp is not always the answer. If the surface flexes, has a rounded finish that the clamp cannot grip, or sits in a high-impact zone where the device will be bumped all day, a drill-base, AMPS plate, magnetic base, or vehicle-specific bracket may be safer. The mount is only as stable as the surface it grips.</p>
<p>Also think about who will move the device. A clamp can be excellent for temporary counters, event booths, work carts, and shared benches because it can be repositioned. For assigned fleet vehicles, public kiosks, and unattended tablets, a fixed or locking setup may be easier to manage across teams.</p>
<p>The other deciding factor is arm length. The farther the device sits from the clamped surface, the more force the clamp has to control. If the phone, tablet, scanner, or camera needs a long reach, move up to a stronger base, a shorter arm, or a fixed AMPS install.</p>
<h2>Forklift and warehouse clamp locations</h2>
${productCard(products.forkliftPillar)}
<p>Forklifts and warehouse vehicles need more planning. A clamp or pillar bracket should not block operator visibility, handholds, overhead guard function, or safe entry and exit. The <a href="${products.forkliftPillar.url}">Metal Forklift Pillar Bracket Mount</a> creates an AMPS-compatible mounting point for forklift and warehouse equipment setups where a standard consumer mount would not be appropriate.</p>
<h2>Good places to use clamp mounts</h2>
<ul>
  <li>Restaurant counters where drilling is not approved.</li>
  <li>Warehouse carts and picking stations that need tablet access.</li>
  <li>Motorcycle, bike, ATV, UTV, and equipment handlebars.</li>
  <li>Retail checkout counters and temporary event booths.</li>
  <li>Work benches, repair stations, maker tables, and training desks.</li>
  <li>Forklift pillars or warehouse vehicle structures when approved by safety teams.</li>
</ul>
<h2>Frequently Asked Questions</h2>
${faqHtml([
      {
        q: "What is a clamp phone mount?",
        a: "A clamp phone mount grips a pole, rail, counter edge, handlebar, shelf, or similar surface so a phone holder can be positioned without suction or drilling.",
      },
      {
        q: "When should I use an AMPS clamp base?",
        a: "Use an AMPS clamp base when you want a removable clamp point that can connect to AMPS plates, arms, tablet holders, phone holders, or camera adapters.",
      },
      {
        q: "Can clamp mounts hold tablets?",
        a: "Yes, if the clamp, arm, and holder are sized for the tablet and the surface is strong enough. Heavier tablets need stronger bases and shorter arms.",
      },
      {
        q: "Are clamp mounts safe for forklifts?",
        a: "They can be used when installed in a safe location that does not block visibility, controls, handholds, or vehicle operation. Warehouse safety review is recommended.",
      },
      {
        q: "What should I measure before buying a clamp mount?",
        a: "Measure the pole, rail, counter, or shelf thickness, then measure the phone or tablet with its case installed.",
      },
    ])}
<p>Clamp mounts are flexible, but they still need planning. Match the clamp to the surface first, then choose the holder and arm for the device.</p>`,
  },
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stripHtml(value) {
  return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function wordCount(value) {
  const text = stripHtml(value);
  if (!text) return 0;
  return text.split(/\s+/).length;
}

function fileSafe(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function productLink(product) {
  return `<a href="${product.url}">${escapeHtml(product.title)}</a>`;
}

function cartUrl(product) {
  return `${SITE}/cart/add?id=${product.variantId}&quantity=1`;
}

const ACTION_LINK_BASE_STYLE =
  "display:inline-block; padding:9px 13px; border-radius:5px; text-decoration:none; font-weight:700; font-size:14px; background-image:none; box-shadow:none;";
const VIEW_PRODUCT_LINK_STYLE =
  `${ACTION_LINK_BASE_STYLE} border:1px solid #101828; color:#101828; background:#fff;`;
const ADD_TO_CART_LINK_STYLE =
  `${ACTION_LINK_BASE_STYLE} background:#101828; color:#fff;`;

function productCard(product) {
  const cart = product.variantId
    ? `<a style="${ADD_TO_CART_LINK_STYLE}" href="${cartUrl(product)}">Add to Cart</a>`
    : `<span class="note">Variant ID needs verification before adding cart link.</span>`;

  return `<div style="display:grid; grid-template-columns:160px 1fr; gap:18px; border:1px solid #d9dee7; border-radius:8px; padding:14px; margin:18px 0; align-items:center;">
  <a href="${product.url}"><img src="${product.image}" alt="${escapeHtml(product.title)}" style="width:160px; max-width:100%; border-radius:6px; display:block;" loading="lazy"></a>
  <div>
    <h3 style="margin:0 0 6px; font-size:18px;">${escapeHtml(product.title)}</h3>
    <p><strong>$${product.price}</strong> | ${escapeHtml(product.type)}</p>
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;"><a style="${VIEW_PRODUCT_LINK_STYLE}" href="${product.url}">View Product</a>${cart}</div>
  </div>
</div>`;
}

function faqHtml(items) {
  return items
    .map(
      (item) => `<div class="faq-item">
  <h3>${escapeHtml(item.q)}</h3>
  <p>${escapeHtml(item.a)}</p>
</div>`
    )
    .join("\n");
}

function faqSchema(items) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
}

function productSchema(product) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    image: product.image,
    sku: product.sku,
    brand: {
      "@type": "Brand",
      name: "iBOLT",
    },
    offers: {
      "@type": "Offer",
      url: product.url,
      priceCurrency: "USD",
      price: product.price,
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
    },
  };
}

function itemListSchema(items, url, name) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    url,
    itemListElement: items.map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Product",
        name: product.title,
        url: product.url,
        image: product.image,
      },
    })),
  };
}

function articleSchema(spec) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: spec.title,
    description: spec.metaDescription,
    url: spec.sourceUrl,
    publisher: {
      "@type": "Organization",
      name: "iBOLT Mounts",
      url: SITE,
    },
    mainEntityOfPage: spec.sourceUrl,
  };
}

function schemaScript(data) {
  return `<script type="application/ld+json">\n${JSON.stringify(data, null, 2)}\n</script>`;
}

function pageFrame({ title, metaTitle, metaDescription, sourceUrl, content, schemas, notes }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(metaTitle)}</title>
  <meta name="description" content="${escapeHtml(metaDescription)}">
  <style>
    body { font-family: Arial, sans-serif; color: #1f2933; margin: 0; background: #f6f7f9; line-height: 1.55; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; background: #fff; min-height: 100vh; }
    h1 { font-size: 34px; line-height: 1.1; margin: 0 0 8px; }
    h2 { font-size: 24px; margin-top: 34px; }
    h3 { font-size: 18px; margin-bottom: 6px; }
    p, li { font-size: 16px; }
    a { color: #0f3b6d; }
    .kicker { color: #667085; font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em; }
    .meta { background: #eef4ff; border: 1px solid #c7d7fe; padding: 14px; border-radius: 8px; margin: 18px 0 28px; }
    .product-card { display: grid; grid-template-columns: 160px 1fr; gap: 18px; border: 1px solid #d9dee7; border-radius: 8px; padding: 14px; margin: 18px 0; align-items: center; }
    .product-card img { width: 160px; max-width: 100%; border-radius: 6px; display: block; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
    .btn { display: inline-block; padding: 9px 13px; border-radius: 5px; border: 1px solid #101828; color: #101828; text-decoration: none; font-weight: 700; font-size: 14px; }
    .btn.dark { background: #101828; color: #fff; }
    .note { display: inline-block; color: #7a2e0e; font-size: 14px; margin-left: 8px; }
    .faq-item { border-top: 1px solid #e5e7eb; padding-top: 12px; margin-top: 12px; }
    .schema { background: #111827; color: #e5e7eb; padding: 14px; overflow: auto; border-radius: 8px; font-size: 12px; }
    .notes { background: #fff7ed; border: 1px solid #fed7aa; padding: 14px; border-radius: 8px; margin-top: 28px; }
    @media (max-width: 640px) { .product-card { grid-template-columns: 1fr; } .product-card img { width: 100%; max-width: 280px; } }
  </style>
</head>
<body>
<main>
  <div class="kicker">Review only | Not published</div>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    <p><strong>Source URL:</strong> <a href="${sourceUrl}">${sourceUrl}</a></p>
    <p><strong>Meta title:</strong> ${escapeHtml(metaTitle)} (${metaTitle.length} chars)</p>
    <p><strong>Meta description:</strong> ${escapeHtml(metaDescription)} (${metaDescription.length} chars)</p>
  </div>
  ${content}
  <h2>Schema Snippets To Add</h2>
  <div class="schema"><pre>${escapeHtml(schemas.map((schema) => JSON.stringify(schema, null, 2)).join("\n\n"))}</pre></div>
  <div class="notes">
    <h2>Implementation Notes</h2>
    ${notes}
  </div>
</main>
</body>
</html>`;
}

function buildProductDraft(spec) {
  const content = `<h2>Draft Product Description</h2>
${spec.body}
${productCard(spec.product)}
<h2>Frequently Asked Questions</h2>
${faqHtml(spec.faqs)}`;

  return {
    ...spec,
    title: spec.product.title,
    html: pageFrame({
      title: spec.product.title,
      metaTitle: spec.metaTitle,
      metaDescription: spec.metaDescription,
      sourceUrl: spec.sourceUrl,
      content,
      schemas: [productSchema(spec.product), faqSchema(spec.faqs)],
      notes: `<p>Recommended Shopify fields: set product type to <strong>${escapeHtml(
        spec.recommendedProductType
      )}</strong> and add tags: ${spec.recommendedTags.map(escapeHtml).join(", ")}.</p>
<p>Keep the product card button only in the product section or template. Do not repeat add-to-cart after every inline link.</p>`,
    }),
    wordCount: wordCount(spec.body),
    schemaCount: 2,
  };
}

function buildCollectionDraft(spec) {
  const productCards = spec.products.map(productCard).join("\n");
  const content = `<h2>Draft Collection Intro</h2>
${spec.body}
<h2>Recommended Products To Feature</h2>
${productCards}
<h2>Frequently Asked Questions</h2>
${faqHtml(spec.faqs)}`;

  return {
    ...spec,
    html: pageFrame({
      title: spec.title,
      metaTitle: spec.metaTitle,
      metaDescription: spec.metaDescription,
      sourceUrl: spec.sourceUrl,
      content,
      schemas: [itemListSchema(spec.products, spec.sourceUrl, spec.title), faqSchema(spec.faqs)],
      notes: `<p>Use this as top or bottom collection copy depending on theme constraints. Best commercial placement is a short intro above products, with FAQ below the grid.</p>
<p>Feature only 3 to 5 products. Avoid turning the collection description into a long blog post.</p>`,
    }),
    wordCount: wordCount(spec.body),
    schemaCount: 2,
  };
}

function buildArticleDraft(spec) {
  return {
    ...spec,
    html: pageFrame({
      title: spec.title,
      metaTitle: spec.metaTitle,
      metaDescription: spec.metaDescription,
      sourceUrl: spec.sourceUrl,
      content: `<h2>Draft Article Refresh</h2>${spec.body}`,
      schemas: [articleSchema(spec), faqSchema(extractFaqsFromBody(spec.body))],
      notes: `<p>Replace or heavily refresh the existing older article. This draft keeps the topic but adds product paths, buyer structure, FAQs, and matching schema.</p>
<p>Product cards use one Add to Cart button per card only, so the page does not repeat cart buttons after every product link.</p>`,
    }),
    wordCount: wordCount(spec.body),
    schemaCount: 2,
  };
}

function shopifyFaqSection(items) {
  return `<h2>Frequently Asked Questions</h2>\n${faqHtml(items)}`;
}

function shopifyProductBody(spec) {
  return `${spec.body}
${shopifyFaqSection(spec.faqs)}
${schemaScript(productSchema(spec.product))}
${schemaScript(faqSchema(spec.faqs))}`;
}

function shopifyCollectionBody(spec) {
  const productCards = spec.products.map(productCard).join("\n");
  return `${spec.body}
<h2>Recommended Starting Points</h2>
${productCards}
${shopifyFaqSection(spec.faqs)}
${schemaScript(itemListSchema(spec.products, spec.sourceUrl, spec.title))}
${schemaScript(faqSchema(spec.faqs))}`;
}

function shopifyArticleBody(spec) {
  const faqs = extractFaqsFromBody(spec.body);
  return `${spec.body}
${schemaScript(articleSchema(spec))}
${schemaScript(faqSchema(faqs))}`;
}

function storefrontFrame({ title, metaTitle, metaDescription, sourceUrl, content, type }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(metaTitle)}</title>
  <meta name="description" content="${escapeHtml(metaDescription)}">
  <style>
    body { margin:0; font-family: Arial, sans-serif; color:#202124; background:#fff; line-height:1.6; }
    .topbar { background:#111827; color:#fff; text-align:center; font-size:12px; padding:8px 12px; letter-spacing:.03em; }
    header { height:72px; display:flex; align-items:center; justify-content:center; border-bottom:1px solid #e5e7eb; position:sticky; top:0; background:#fff; z-index:2; }
    .brand { font-weight:800; font-size:24px; letter-spacing:-.02em; }
    main { max-width:880px; margin:0 auto; padding:36px 22px 72px; }
    .eyebrow { color:#667085; text-transform:uppercase; letter-spacing:.08em; font-size:12px; font-weight:700; }
    h1 { font-size:42px; line-height:1.08; margin:10px 0 14px; letter-spacing:0; }
    h2 { font-size:30px; line-height:1.18; margin-top:40px; letter-spacing:0; }
    h3 { font-size:20px; line-height:1.25; margin-top:22px; letter-spacing:0; }
    p, li { font-size:17px; }
    a { color:#1f2937; text-decoration:underline; text-underline-offset:2px; font-weight:650; }
    img { max-width:100%; height:auto; }
    .meta { color:#667085; font-size:14px; margin-bottom:28px; }
    .draft { background:#fef3c7; border:1px solid #f59e0b; border-radius:6px; padding:12px 14px; margin:0 0 26px; font-size:14px; }
    .source { border-top:1px solid #e5e7eb; margin-top:44px; padding-top:16px; color:#667085; font-size:14px; }
    script { display:none; }
    @media (max-width:640px) {
      main { padding:28px 18px 56px; }
      h1 { font-size:34px; }
      h2 { font-size:26px; }
      p, li { font-size:16px; }
      div[style*="grid-template-columns:160px"] { display:block !important; }
      div[style*="grid-template-columns:160px"] img { width:100% !important; max-width:280px !important; }
    }
  </style>
</head>
<body>
  <div class="topbar">SHIPS WITHIN 24 BUSINESS HOURS | FREE SHIPPING ON ORDERS OVER $75</div>
  <header><div class="brand">iBOLT Mounts</div></header>
  <main>
    <div class="eyebrow">${escapeHtml(type)} draft preview</div>
    <h1>${escapeHtml(title)}</h1>
    <p class="meta">Preview only. This is Shopify-ready HTML and has not been published.</p>
    <div class="draft"><strong>Draft mode:</strong> use this preview to review the customer-facing layout before any Shopify update.</div>
    ${content}
    <p class="source">Source target: <a href="${sourceUrl}">${sourceUrl}</a></p>
  </main>
</body>
</html>`;
}

function shopifyReadyIndex(items) {
  const rows = items
    .map(
      (item) => `<tr>
  <td>${escapeHtml(item.targetType)}</td>
  <td>${escapeHtml(item.title)}</td>
  <td><a href="${item.previewFile}">Preview</a></td>
  <td><a href="${item.bodyFile}">Shopify HTML</a></td>
  <td><a href="${item.payloadFile}">Payload JSON</a></td>
</tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shopify-Ready iBOLT Drafts</title>
  <style>
    body { font-family: Arial, sans-serif; margin:0; background:#f6f7f9; color:#111827; }
    main { max-width:1100px; margin:0 auto; padding:32px 20px 56px; background:#fff; min-height:100vh; }
    table { width:100%; border-collapse:collapse; margin-top:18px; }
    th, td { border:1px solid #d9dee7; padding:10px; text-align:left; vertical-align:top; }
    th { background:#eef4ff; }
    .note { background:#fff7ed; border:1px solid #fed7aa; padding:14px; border-radius:8px; }
  </style>
</head>
<body>
<main>
  <h1>Shopify-Ready iBOLT Drafts</h1>
  <p>These are clean Shopify-ready previews and HTML snippets. Nothing has been published or pushed to Shopify.</p>
  <div class="note">Product and collection updates are live surfaces in Shopify, so these are local preview and payload files only. Article refreshes can be created as unpublished Shopify drafts later if you approve them.</div>
  <table>
    <thead><tr><th>Type</th><th>Draft</th><th>Store-style preview</th><th>HTML snippet</th><th>Payload</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</main>
</body>
</html>`;
}

function extractFaqsFromBody(html) {
  const matches = [...html.matchAll(/<h3>(.*?)<\/h3>\s*<p>(.*?)<\/p>/g)];
  return matches
    .filter(([, q]) => q.includes("?"))
    .map(([, q, a]) => ({ q: stripHtml(q), a: stripHtml(a) }));
}

function validateDraft(draft) {
  const lower = stripHtml(draft.html).toLowerCase();
  const forbiddenHits = forbiddenPhrases.filter((phrase) => lower.includes(phrase));
  return {
    id: draft.id,
    targetType: draft.targetType,
    sourceUrl: draft.sourceUrl,
    metaTitleLength: draft.metaTitle.length,
    metaDescriptionLength: draft.metaDescription.length,
    wordCount: draft.wordCount,
    schemaCount: draft.schemaCount,
    forbiddenHits,
    hasFaq: /frequently asked questions/i.test(draft.html),
    hasProductLinks: /iboltmounts\.com\/products\//i.test(draft.html),
    hasCartLinks: /\/cart\/add\?id=/i.test(draft.html),
    status:
      forbiddenHits.length === 0 &&
      draft.metaTitle.length <= 60 &&
      draft.metaDescription.length <= 155 &&
      draft.wordCount >= (draft.targetType === "article_refresh" ? 750 : 150)
        ? "pass"
        : "review",
  };
}

function outputDirName(targetType) {
  if (targetType === "product") return "products";
  if (targetType === "collection") return "collections";
  if (targetType === "article_refresh") return "article-refreshes";
  throw new Error(`Unknown target type: ${targetType}`);
}

function indexHtml(allDrafts, validations) {
  const rows = allDrafts
    .map((draft) => {
      const validation = validations.find((item) => item.id === draft.id);
      const file = `${outputDirName(draft.targetType)}/${fileSafe(draft.id)}.html`;
      return `<tr>
  <td>${escapeHtml(draft.targetType)}</td>
  <td><a href="${file}">${escapeHtml(draft.title)}</a></td>
  <td>${draft.wordCount}</td>
  <td>${validation.metaTitleLength}/${validation.metaDescriptionLength}</td>
  <td>${validation.hasFaq ? "yes" : "no"}</td>
  <td>${validation.hasProductLinks ? "yes" : "no"}</td>
  <td>${validation.status}</td>
</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>iBOLT SEO Review Package</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; background: #f6f7f9; color: #111827; }
    main { max-width: 1120px; margin: 0 auto; background: #fff; padding: 32px 20px 56px; min-height: 100vh; }
    h1 { margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; }
    th, td { border: 1px solid #d9dee7; padding: 10px; text-align: left; vertical-align: top; }
    th { background: #eef4ff; }
    .callout { background: #ecfdf3; border: 1px solid #abefc6; padding: 14px; border-radius: 8px; margin: 18px 0; }
    .warn { background: #fff7ed; border: 1px solid #fed7aa; padding: 14px; border-radius: 8px; margin: 18px 0; }
    code { background: #f3f4f6; padding: 2px 4px; border-radius: 4px; }
  </style>
</head>
<body>
<main>
  <h1>iBOLT SEO Content Review Package</h1>
  <p>Generated June 10, 2026. Review-only drafts from the Shopify SEO audit. Nothing in this package has been published.</p>
  <div class="callout">
    <strong>Recommended order:</strong> publish product description fixes first, then collection intros and FAQs, then older article refreshes. Product and collection work improves the commercial pages that blog traffic lands on.
  </div>
  <div class="warn">
    <strong>Important:</strong> these drafts intentionally exclude the two internal AI-search explainer sections Katie flagged. Add-to-cart appears only inside product cards, not after every inline link.
  </div>
  <table>
    <thead>
      <tr>
        <th>Type</th>
        <th>Draft</th>
        <th>Words</th>
        <th>Meta chars</th>
        <th>FAQ</th>
        <th>Product links</th>
        <th>Validation</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <h2>Supporting Files</h2>
  <ul>
    <li><a href="shopify-ready-index.html">shopify-ready-index.html</a></li>
    <li><a href="manifest.json">manifest.json</a></li>
    <li><a href="shopify-ready-manifest.json">shopify-ready-manifest.json</a></li>
    <li><a href="validation.json">validation.json</a></li>
    <li><a href="README.md">README.md</a></li>
  </ul>
</main>
</body>
</html>`;
}

function readme(allDrafts, validations) {
  const lines = allDrafts
    .map((draft) => {
      const validation = validations.find((item) => item.id === draft.id);
      const file = `${outputDirName(draft.targetType)}/${fileSafe(draft.id)}.html`;
      return `| ${draft.targetType} | [${draft.title}](${file}) | ${draft.wordCount} | ${validation.status} |`;
    })
    .join("\n");

  return `# iBOLT SEO Content Review Package

Generated: 2026-06-10

This is review-only content. Nothing was published to Shopify.

## Publish Order

1. Product descriptions for the four highest-priority commercial products.
2. Collection intro copy and FAQs for Live Streaming, ELD, 20mm adapters, and Smartphone Phone Mounts.
3. Older article refreshes for restaurant multi-tablet, ELD, and clamp mount content.

## Drafts

| Type | Draft | Words | Validation |
| --- | --- | ---: | --- |
${lines}

## Notes

- Open [shopify-ready-index.html](shopify-ready-index.html) to see store-style previews and clean Shopify HTML snippets.
- Add-to-cart buttons are limited to product cards.
- FAQPage schema is included where visible FAQs are included.
- Product schema and Offer schema are included for product drafts.
- ItemList schema is included for collection drafts.
- Article schema is included for article refreshes.
- The two internal AI-search explainer headings are intentionally excluded.
`;
}

async function main() {
  const dirs = [
    "products",
    "collections",
    "article-refreshes",
    "shopify-ready/products",
    "shopify-ready/collections",
    "shopify-ready/article-refreshes",
    "shopify-ready/payloads",
    "storefront-previews/products",
    "storefront-previews/collections",
    "storefront-previews/article-refreshes",
  ];
  await mkdir(OUT_DIR, { recursive: true });
  for (const dir of dirs) {
    await mkdir(path.join(OUT_DIR, dir), { recursive: true });
  }

  const builtProducts = productDrafts.map(buildProductDraft);
  const builtCollections = collectionDrafts.map(buildCollectionDraft);
  const builtArticles = articleDrafts.map(buildArticleDraft);
  const allDrafts = [...builtProducts, ...builtCollections, ...builtArticles];
  const validations = allDrafts.map(validateDraft);

  for (const draft of allDrafts) {
    const dir = outputDirName(draft.targetType);
    await writeFile(path.join(OUT_DIR, dir, `${fileSafe(draft.id)}.html`), draft.html);
  }

  const shopifyReadyItems = [
    ...productDrafts.map((spec) => ({
      id: spec.id,
      targetType: spec.targetType,
      title: spec.product.title,
      sourceUrl: spec.sourceUrl,
      metaTitle: spec.metaTitle,
      metaDescription: spec.metaDescription,
      bodyHtml: shopifyProductBody(spec),
      payload: {
        mode: "review_only_do_not_submit_without_approval",
        target: spec.sourceUrl,
        shopifyResource: "product",
        suggestedFields: {
          body_html: shopifyProductBody(spec),
          product_type: spec.recommendedProductType,
          tags: spec.recommendedTags,
          seo: {
            title_tag: spec.metaTitle,
            description_tag: spec.metaDescription,
          },
        },
      },
    })),
    ...collectionDrafts.map((spec) => ({
      id: spec.id,
      targetType: spec.targetType,
      title: spec.title,
      sourceUrl: spec.sourceUrl,
      metaTitle: spec.metaTitle,
      metaDescription: spec.metaDescription,
      bodyHtml: shopifyCollectionBody(spec),
      payload: {
        mode: "review_only_do_not_submit_without_approval",
        target: spec.sourceUrl,
        shopifyResource: "collection",
        suggestedFields: {
          body_html: shopifyCollectionBody(spec),
          seo: {
            title_tag: spec.metaTitle,
            description_tag: spec.metaDescription,
          },
        },
      },
    })),
    ...articleDrafts.map((spec) => ({
      id: spec.id,
      targetType: spec.targetType,
      title: spec.title,
      sourceUrl: spec.sourceUrl,
      metaTitle: spec.metaTitle,
      metaDescription: spec.metaDescription,
      bodyHtml: shopifyArticleBody(spec),
      payload: {
        mode: "unpublished_draft_only_do_not_publish_without_approval",
        target: spec.sourceUrl,
        shopifyResource: "article",
        suggestedFields: {
          title: spec.title,
          body_html: shopifyArticleBody(spec),
          summary_html: spec.metaDescription,
          tags: ["seo-refresh", "review-draft"],
          published: false,
          seo: {
            title_tag: spec.metaTitle,
            description_tag: spec.metaDescription,
          },
        },
      },
    })),
  ];

  for (const item of shopifyReadyItems) {
    const dir = outputDirName(item.targetType);
    const filename = fileSafe(item.id);
    const bodyFile = `shopify-ready/${dir}/${filename}.body.html`;
    const payloadFile = `shopify-ready/payloads/${filename}.json`;
    const previewFile = `storefront-previews/${dir}/${filename}.html`;

    await writeFile(path.join(OUT_DIR, bodyFile), item.bodyHtml);
    await writeFile(path.join(OUT_DIR, payloadFile), JSON.stringify(item.payload, null, 2));
    await writeFile(
      path.join(OUT_DIR, previewFile),
      storefrontFrame({
        title: item.title,
        metaTitle: item.metaTitle,
        metaDescription: item.metaDescription,
        sourceUrl: item.sourceUrl,
        content: item.bodyHtml,
        type: item.targetType.replace("_", " "),
      })
    );

    item.bodyFile = bodyFile;
    item.payloadFile = payloadFile;
    item.previewFile = previewFile;
    item.wordCount = wordCount(item.bodyHtml);
  }

  const manifest = allDrafts.map((draft) => ({
    id: draft.id,
    targetType: draft.targetType,
    title: draft.title,
    sourceUrl: draft.sourceUrl,
    metaTitle: draft.metaTitle,
    metaDescription: draft.metaDescription,
    wordCount: draft.wordCount,
    outputFile: `${outputDirName(draft.targetType)}/${fileSafe(draft.id)}.html`,
  }));

  await writeFile(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(OUT_DIR, "validation.json"), JSON.stringify(validations, null, 2));
  await writeFile(path.join(OUT_DIR, "review-index.html"), indexHtml(allDrafts, validations));
  await writeFile(
    path.join(OUT_DIR, "shopify-ready-index.html"),
    shopifyReadyIndex(shopifyReadyItems)
  );
  await writeFile(
    path.join(OUT_DIR, "shopify-ready-manifest.json"),
    JSON.stringify(
      shopifyReadyItems.map((item) => ({
        id: item.id,
        targetType: item.targetType,
        title: item.title,
        sourceUrl: item.sourceUrl,
        previewFile: item.previewFile,
        bodyFile: item.bodyFile,
        payloadFile: item.payloadFile,
        wordCount: item.wordCount,
      })),
      null,
      2
    )
  );
  await writeFile(path.join(OUT_DIR, "README.md"), readme(allDrafts, validations));

  const failed = validations.filter((item) => item.status !== "pass" || item.forbiddenHits.length);
  console.log(JSON.stringify({ outDir: OUT_DIR, drafts: allDrafts.length, failed }, null, 2));
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
