#!/usr/bin/env node

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const SITE = "https://iboltmounts.com";
const OUT_DIR = path.resolve("content-output/aeo-solution-pages-2026-06-08");
const GENERATED_CLAMP_BROLL =
  process.env.CLAMP_BROLL_SOURCE ||
  "/Users/yakub/.codex/generated_images/019e617d-73b4-7811-827e-b49c7d1ff72a/ig_0cd0dd4d9cd53780016a275195c7d08198b7ec34588881e67f.png";

const uploadedBroll = {
  restaurant:
    "https://cdn.shopify.com/s/files/1/0818/5957/6100/articles/f738a99aab4736fb11e7af3f6be8f294_93c1360e-61c9-49b6-a8ef-f13276bf8f56.png?v=1780193005",
  fleet:
    "https://cdn.shopify.com/s/files/1/0818/5957/6100/articles/9f50bafb1e3f048b865b4ae478534469_d4589621-854a-41c4-9a8f-c2bd09e6e8e5.png?v=1780193011",
  restaurantSecurity:
    "https://cdn.shopify.com/s/files/1/0818/5957/6100/articles/e047b861c33c0be2183e3b376dd6afa0_1468d744-575d-4d8e-80ee-fbd277d59d2e.png?v=1780193017",
};

const fallbackProducts = {
  "tablet-tower-multi-tablet-stand-ipad-point-of-sale-purchase-restaurant-triple-ibrt-34700": {
    title: "iBOLT Tablet Tower POS Clamp Mount with 3 Tablet Holders",
    price: 79.95,
    variantId: 50140722495780,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-tabdock-ibolt-tablet-tower-tabdock-pos-clamp-mount-with-3-tablet-holders-1050408260.jpg?v=1768848789",
  },
  "ibolt-quad-tablet-tower-stand": {
    title: "iBOLT Quad Tablet Tower TabDock Stand",
    price: 149.95,
    variantId: 50140503015716,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-tabdock-ibolt-quad-tablet-tower-tabdock-stand-1050407691.jpg?v=1768921811",
  },
  "ibolttm-lockprotm-drill-base-locking-tablet-stand-point-of-purchase-pos-mount": {
    title: "iBOLT LockPro Drill Base Locking Tablet Stand POS Mount",
    price: 139.95,
    variantId: 47015317766436,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-lockpro-drill-base-locking-tablet-stand-point-of-purchase-pos-mount-1050409814.jpg?v=1768913232",
  },
  "multi-tablet-stand-four-ipad-holders-point-of-sale-purchase-restaurant-ibrt-34707": {
    title: "iBOLT Tablet Tower POS Clamp Mount with 4 Tablet Holders",
    price: 89.95,
    variantId: 50140727607588,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-tabdock-ibolt-tablet-tower-tabdock-pos-clamp-mount-with-4-tablet-holders-1050408283.jpg?v=1768885931",
  },
  "multi-tablet-stand-five-holders-restaurant-point-of-sale-purchase-ipad-ibrt-34706": {
    title: "iBOLT Tablet Tower POS Clamp Mount with 5 Tablet Holders",
    price: 99.95,
    variantId: 50140732719396,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-tabdock-ibolt-tablet-tower-tabdock-pos-clamp-mount-with-5-tablet-holders-1050408293.jpg?v=1768885690",
  },
  "ibolt-tabdock-point-of-purchase-pos-wall-mount-with-4-tablet-holders": {
    title: "iBOLT Tablet Tower POS Wall Mount with 4 Tablet Holders",
    price: 134.95,
    variantId: 50140750119204,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-tabdock-ibolt-tablet-tower-tabdock-pos-wall-mount-with-4-tablet-holders-1050408318.jpg?v=1768885753",
  },
  "ibolt-dock-n-lock-pos-tablet-stand": {
    title: "iBOLT Dock'n Lock POS Tablet Stand",
    price: 99.95,
    variantId: 50379545411876,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/files/ibolt-mounts-ibolt-dock-n-lock-pos-tablet-stand-1130354044.jpg?v=1768836072",
  },
  "ibolt-amps-to-vesa-75-100-plate": {
    title: "iBOLT AMPS to VESA 75/100 Plate",
    price: 14.95,
    variantId: 51971790897444,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/files/ibolt-mounts-ibolt-amps-to-vesa-75-100-plate-1218689149.webp?v=1769743209",
  },
  "25mm-1-inch-b-size-metal-amps-pattern-adapter-plate-ibpb-33890": {
    title: "iBOLT 25mm / 1 inch Metal AMPS Adapter Plate",
    price: 12.95,
    variantId: 47014777094436,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-25mm-1-inch-metal-amps-adapter-plate-1050406880.jpg?v=1768893670",
  },
  "ibolt-25mm-1-inch-composite-amps-adapter-plate-dual-ball-socket-mounting-arms": {
    title: "iBOLT 25mm / 1 inch Composite AMPS Adapter Plate",
    price: 7.95,
    variantId: 47014690455844,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-25mm-1-inch-composite-amps-adapter-plate-1050406858.jpg?v=1768855209",
  },
  "industry-standard-amps-packing-plate": {
    title: "iBOLT 4 Hole AMPS Pattern Metal Backing Plate",
    price: 7.95,
    variantId: 47014634291492,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-4-hole-amps-pattern-metal-backing-plate-1050409570.jpg?v=1768857609",
  },
  "ibolt-universal-marine-electronics-mounting-plate": {
    title: "iBOLT Universal Marine and Electronics Mounting Plate",
    price: 12.95,
    variantId: 51993823641892,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/files/ibolt-mounts-ibolt-universal-marine-electronics-mounting-plate-1219641325.jpg?v=1770421453",
  },
  "ibolt-clamp-base-for-4-hole-amps-mounts": {
    title: "iBOLT Clamp Base for 4-Hole AMPS Mounts",
    price: 24.95,
    variantId: 50983084392740,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/files/ibolt-mounts-ibolt-clamp-base-for-4-hole-amps-mounts-1184305715.jpg?v=1768825330",
  },
  "tabdock-bizmount-amps-heavy-duty-drill-base-tablet-mount-ibbz-33921": {
    title: "iBOLT TabDock Bizmount AMPS Drill Base Tablet Mount",
    price: 29.95,
    variantId: 50140414673188,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/files/ibolt-mounts-tabdock-ibolt-tabdock-bizmount-amps-1050410048.jpg?v=1768914010",
  },
  "xprodock-bizmount-amps-smartphone-drill-base-mount-ibbz-33931": {
    title: "iBOLT xProDock Bizmount AMPS Phone Mount",
    price: 39.95,
    variantId: 47014641402148,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-xprodock-bizmount-amps-1050410162.jpg?v=1768868290",
  },
  "ibolt-38mm-1-5-inch-metal-rectangular-amps-pattern-to-20-metal-camera-screw-dual-ball-mount-featuring-a-3-5-inch-composite-38mm-bizmount-arm": {
    title: "iBOLT 38mm AMPS to 1/4-20 Camera Screw Mount",
    price: 29.95,
    variantId: 47015197483268,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/files/ibolt-mounts-ibolt-38mm-1-5-inch-metal-rectangular-amps-pattern-to-1-4-20-metal-camera-screw-dual-ball-mount-featuring-a-3-5-inch-composite-38mm-bizmount-arm-1130819284.jpg?v=1768840990",
  },
  "ibolt-tabdock-bizmount-pillar-mount-heavy-duty-forklift-tablet-mount-for-warehouse-vehicles-and-7-10-inch-tablets": {
    title: "iBOLT TabDock Bizmount Pillar Forklift Tablet Mount",
    price: 74.95,
    variantId: 50140522250532,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/files/ibolt-mounts-tabdock-ibolt-tabdock-bizmount-pillar-mount-heavy-duty-forklift-tablet-mount-for-warehouse-vehicles-and-7-10-inch-tablets-1091238368.jpg?v=1768829590",
  },
  "ibolt-lockprotm-incredibolttm-360-pillar-mount-heavy-duty-forklift-tablet-mount-for-warehouse-vehicles-and-7-10-inch-tablets": {
    title: "iBOLT LockPro IncrediBOLT 360 Pillar Forklift Tablet Mount",
    price: 169.95,
    variantId: 47015315243300,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-lockpro-incredibolt-360-pillar-mount-heavy-duty-forklift-tablet-mount-for-warehouse-vehicles-and-7-10-inch-tablets-1050407447.jpg?v=1768922110",
  },
  "ibolt-xl-barcode-scanner-forklift-pillar-mount-for-warehouse-vehicles-inventory-management-and-material-handling": {
    title: "iBOLT XL Barcode Scanner Forklift Pillar Mount",
    price: 72,
    variantId: 49920014057764,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/files/ibolt-mounts-ibolt-xl-barcode-scanner-forklift-pillar-mount-for-warehouse-vehicles-inventory-management-and-material-handling-1083126022.jpg?v=1768825449",
  },
  "ibolt-xl-forklift-barcode-scanner-holder-38mm-mount": {
    title: "iBOLT XL Forklift Barcode Scanner Holder 38mm Mount",
    price: 79.95,
    variantId: 52320724222244,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/files/ibolt-mounts-ibolt-xl-forklift-barcode-scanner-holder-38mm-mount-1228069668.jpg?v=1773948070",
  },
  "ibolt-vesa-75x75-mm-100x100-mm-monitor-pillar-mount": {
    title: "iBOLT VESA 75x75 mm / 100x100 mm Monitor Pillar Mount",
    price: 69.95,
    variantId: 47015302922532,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-vesa-75x75-mm-100x100-mm-monitor-pillar-mount-1050408039.jpg?v=1768921510",
  },
  "ibolt-tabdocktm-incredibolttm-360-suction-heavy-duty-metal-6-inch-multi-angle-mount-for-all-7-10-tablets-for-commercial-vehicles-trucks-and-eld-devices": {
    title: "iBOLT TabDock IncrediBOLT 360 Suction ELD Tablet Mount",
    price: 74.95,
    variantId: 50140633268516,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-tabdock-ibolt-tabdock-incredibolt-360-suction-heavy-duty-metal-6-inch-multi-angle-mount-for-all-7-10-tablets-for-commercial-vehicles-trucks-and-eld-devices-1050408033.jpg?v=1768904470",
  },
  "ibolt-tabdock-incredibolt-360-heavy-duty-triple-suction-cup-mount": {
    title: "iBOLT TabDock IncrediBOLT 360 Heavy Duty Triple Suction Cup Mount",
    price: 89.95,
    variantId: 50140553838884,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/files/ibolt-mounts-tabdock-ibolt-tabdock-incredibolt-360-heavy-duty-triple-suction-cup-mount-1050446044.jpg?v=1768872852",
  },
  "ibolt-lockpro-flexpro-heavy-duty-locking-tablet-seat-rail-mount": {
    title: "iBOLT LockPro FlexPro Heavy Duty Locking Tablet Seat Rail Mount",
    price: 159.95,
    variantId: 51110115377444,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/files/ibolt-mounts-ibolt-lockpro-flexpro-heavy-duty-locking-tablet-seat-rail-mount-1194270682.jpg?v=1768829170",
  },
  "ibolt-tabdock-flexpro-heavy-duty-seat-rail-gooseneck-tablet-eld-floor-mount-ibbz-33762": {
    title: "iBOLT TabDock FlexPro Seat Rail Tablet ELD Mount",
    price: 34.95,
    variantId: 50140630581540,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-tabdock-ibolt-tabdock-flexpro-heavy-duty-seat-rail-gooseneck-tablet-eld-floor-mount-1050408777.jpg?v=1768864930",
  },
  "heavy-duty-smartphone-suction-cup-mount-xprodock-bizmount-ibbz-33785": {
    title: "iBOLT xProDock BizMount Suction Cup Phone Mount",
    price: 39.95,
    variantId: 47014638723364,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-xprodock-bizmount-suction-cup-1050409578.jpg?v=1768870450",
  },
  "ibolttm-stream-cast-incredibolttm-stand-adjustable-overhead-phone-mount": {
    title: "iBOLT Stream-Cast Adjustable Overhead Phone Mount",
    price: 84.95,
    variantId: 47015336313124,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-stream-cast-incredibolt-stand-adjustable-overhead-phone-mount-1050409986.jpg?v=1768913830",
  },
  "ibolt-stream-cast-creator-custom-mount-kit-with-over-60-variations-live-streaming-tutorial-videos-ibsc-34615": {
    title: "iBOLT Stream-Cast Creator Custom Mount Kit",
    price: 139.95,
    variantId: 47014797181220,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-stream-cast-creator-custom-mount-kit-with-over-60-variations-great-for-live-streaming-tutorial-videos-and-photos-1050407750.jpg?v=1768845551",
  },
  "phone-tablet-slide-bar-camera-screw-tripod-attachment-ibcm-34603": {
    title: "3 Camera Phone and Tablet Slide Bar",
    price: 34.95,
    variantId: 47014667092260,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-3-camera-phone-tablet-slide-bar-10-inch-1050406484.jpg?v=1768893610",
  },
  "ibolt-stream-cast-overhead-camera-rig-desk-mount-for-dslr-cameras-for-top-down-and-front-facing-photography": {
    title: "iBOLT Stream-Cast Overhead Camera Rig Desk Mount",
    price: 179.95,
    variantId: 47015092388132,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-stream-cast-overhead-camera-rig-desk-mount-for-dslr-cameras-for-top-down-and-front-facing-photography-1050407814.jpg?v=1768919590",
  },
  "ibolt-1-4-20-camera-screw-incredibolt-suction-cup-mount-secure-adjustable-mount-for-cameras-accessories": {
    title: "iBOLT 1/4-20 Camera Screw IncrediBOLT Suction Cup Mount",
    price: 24.95,
    variantId: 50383432810788,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/files/ibolt-mounts-ibolt-1-4-20-camera-screw-incredibolt-suction-cup-mount-secure-adjustable-mount-for-cameras-accessories-1130818920.jpg?v=1768836970",
  },
  "ibolt-gopro-action-camera-incredibolt-clamp-handlebar-rail-mount-1": {
    title: "iBOLT GoPro / Action Camera IncrediBOLT 360 Clamp Mount",
    price: 49.95,
    variantId: 47015173783844,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-gopro-action-camera-incredibolt-360-clamp-handlebar-rail-mount-1050408409.jpg?v=1768893130",
  },
  "ibolt-spro2-grip-compact-clamp-mount": {
    title: "iBOLT sPro2 Grip Compact Clamp Mount",
    price: 21.95,
    variantId: 50158939078948,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/files/ibolt-mounts-ibolt-spro2-grip-compact-clamp-mount-1098723167.jpg?v=1768838170",
  },
  "ibolt-moto-vise-incredibolt-heavy-duty-phone-clamp-handlebar-rail-mount": {
    title: "iBOLT Moto-Vise IncrediBOLT Heavy Duty Phone Clamp Mount",
    price: 64.95,
    variantId: 47015187251492,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-moto-vise-incredibolt-heavy-duty-phone-clamp-handlebar-rail-mount-1050407613.jpg?v=1768902070",
  },
  "ibolt-17mm-dual-ball-clamping-mount-for-handlebars-poles-posts-compatible-w-garmin-gps-systems-and-ibolt-phone-holders": {
    title: "iBOLT 17mm Dual Ball Clamping Mount",
    price: 29.95,
    variantId: 47015102120228,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-17mm-dual-ball-clamping-mount-for-handlebars-poles-posts-for-garmin-gps-systems-and-ibolt-phone-holders-1050406717.jpg?v=1768892710",
  },
  "ibolt-22mm-clamp-mount-for-handlebars-poles-posts-and-industry-standard-22mm-ball-mounts": {
    title: "iBOLT 22mm Clamp Mount for Handlebars, Poles, and Posts",
    price: 11.95,
    variantId: 47015102218532,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-22mm-clamp-mount-for-handlebars-poles-posts-and-industry-standard-22mm-ball-mounts-1050406721.jpg?v=1768892950",
  },
  "ibolt-20mm-clamp-secure-mount-for-atvs-utvs-ag-equipment": {
    title: "iBOLT 20mm Clamp for ATVs, UTVs, and Ag Equipment",
    price: 26.96,
    variantId: 51047373783332,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/files/ibolt-mounts-ibolt-20mm-clamp-secure-mount-for-atvs-utvs-ag-equipment-1186242275.jpg?v=1768836610",
  },
  "ibolt-17mm-clamp-mount-for-handlebars-poles-posts-compatible-with-garmin-gps-systems-and-ibolt-smartphone-holders": {
    title: "iBOLT 17mm Clamp Mount for Handlebars, Poles, and Posts",
    price: 14.95,
    variantId: 47014979731748,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-17mm-clamp-mount-for-handlebars-poles-posts-1050408694.jpg?v=1768907771",
  },
  "25mm-1-inch-ball-b-size-adjustable-clamp-mount-22174": {
    title: "iBOLT 25mm / 1 inch Metal C-Clamp Mount",
    price: 15.95,
    variantId: 47014638715172,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-25mm-1-inch-b-size-metal-c-clamp-mount-1050409002.jpg?v=1768909329",
  },
  "1-inch-25mm-b-size-ball-1-4-20-camera-screw-mount-adapter": {
    title: "iBOLT 25mm / 1 inch Ball to 1/4-20 Camera Screw Adapter",
    price: 7.95,
    variantId: 47014679839012,
    image:
      "https://cdn.shopify.com/s/files/1/0818/5957/6100/products/ibolt-mounts-ibolt-25mm-1-inch-ball-to-20-camera-screw-mount-adapter-1050408961.jpg?v=1768909152",
  },
};

const handles = Array.from(new Set(Object.keys(fallbackProducts)));

const pages = [
  {
    key: "restaurant",
    title: "Restaurant Tablet Mounts and Multi-Tablet Delivery Stations",
    metaTitle: "Restaurant Tablet Mounts and Delivery Stations",
    metaDescription:
      "Shop restaurant tablet mounts, multi-tablet holders, POS stands, and delivery app stations for DoorDash, Uber Eats, Toast, and more.",
    slug: "restaurant-tablet-mounts-multi-tablet-delivery-stations",
    primaryKeywords: ["restaurant tablet mount", "multiple tablet mount", "multiple tablet holder"],
    collectionUrl: `${SITE}/collections/point-of-sale-pos-purchase-retail-restaurant-tablet-mounts1`,
    products: [
      "ibolt-quad-tablet-tower-stand",
      "tablet-tower-multi-tablet-stand-ipad-point-of-sale-purchase-restaurant-triple-ibrt-34700",
      "multi-tablet-stand-four-ipad-holders-point-of-sale-purchase-restaurant-ibrt-34707",
      "multi-tablet-stand-five-holders-restaurant-point-of-sale-purchase-ipad-ibrt-34706",
      "ibolttm-lockprotm-drill-base-locking-tablet-stand-point-of-purchase-pos-mount",
    ],
    broll: {
      src: uploadedBroll.restaurant,
      alt: "Restaurant counter with multiple tablets organized for POS and delivery apps",
      reason:
        "Shows the operational problem this page solves: several ordering tablets competing for the same restaurant counter space.",
    },
    howTo: {
      name: "How to build a multi-tablet restaurant delivery station",
      steps: [
        "Count every POS, delivery, ordering, and kitchen-display tablet that needs to stay visible during a rush.",
        "Decide whether the station should clamp to a counter, mount to a wall, or use a weighted POS base.",
        "Choose a 3, 4, or 5 holder Tablet Tower based on current platforms plus one open position for growth.",
        "Route charging cables behind the station so staff can read every screen without cords crossing prep space.",
      ],
    },
    faqs: [
      [
        "What is the best restaurant tablet mount for multiple delivery apps?",
        "A purpose-built multi-tablet holder is usually better than several single tablet stands. The iBOLT Tablet Tower keeps DoorDash, Uber Eats, Grubhub, Toast, and other tablets in one readable station instead of spreading devices across the counter.",
      ],
      [
        "How many tablets can a restaurant tablet mount hold?",
        "iBOLT Tablet Tower clamp mounts are available with 3, 4, or 5 tablet holders. Wall-mounted versions are also available for restaurants that want delivery tablets off the counter.",
      ],
      [
        "Should restaurant tablets be wall mounted or counter mounted?",
        "Use a wall mount when counter space is tight or when the expo line needs eye-level screens. Use a clamp or POS stand when the station needs to sit at a host stand, checkout counter, or temporary prep area.",
      ],
      [
        "Do iBOLT restaurant tablet mounts work with iPads and Samsung tablets?",
        "The TabDock holders are built for common 7 to 10 inch tablets, including many iPad, Samsung Galaxy Tab, and Fire tablet models. Always confirm the exact tablet size and case thickness before ordering.",
      ],
      [
        "Why not use normal tablet stands for delivery app tablets?",
        "Consumer tablet stands are easy to move, tip, or lose in a busy kitchen. Restaurant mounting needs visibility, cable control, security, and a smaller footprint than separate stands can provide.",
      ],
    ],
    sections: (p) => [
      `<p>The modern restaurant counter was never designed for five screens. One tablet runs Toast or Square, another catches DoorDash orders, another watches Uber Eats, and a fourth may be tied to Grubhub or a house delivery workflow. When those tablets sit loose on the counter, staff miss pings, chargers tangle around prep space, and expensive devices end up near spills.</p>`,
      `<p>This is where a dedicated <strong>restaurant tablet mount</strong> becomes more than a hardware accessory. It becomes part of the order flow. iBOLT builds multi-tablet delivery stations for restaurants that need every screen visible, charged, and out of the way during the rush.</p>`,
      `<h2>Why Multi-Tablet Restaurants Need a Real Station</h2>`,
      `<p>A single-device POS stand can work for a coffee counter. It does not solve the back-of-house delivery problem. Restaurants that run several third-party apps need a <strong>multiple tablet mount</strong> or <strong>multiple tablet holder</strong> that puts all screens in one organized sightline.</p>`,
      `<p>The iBOLT Tablet Tower line is built for that exact workflow. Instead of buying separate stands for every device, restaurants can use one vertical or wall-mounted station with 3, 4, or 5 tablet holders. That means fewer devices on prep counters, better screen visibility, and a cleaner charging setup.</p>`,
      heroImage(p, "restaurant"),
      `<h2>Choose the Right Tablet Tower Layout</h2>`,
      `<p>The right layout depends on where the tablets live. A clamp mount works well at a counter edge or shelf where drilling is not ideal. A wall mount is better near the kitchen pass because it keeps devices at eye level and frees every inch of counter space. A POS stand is better for a host stand or checkout counter where one tablet needs to face staff or customers.</p>`,
      `<p>For most delivery-heavy restaurants, start with a 3-holder or 4-holder Tablet Tower. Add the 5-holder version if you run several platforms, virtual brands, or separate kitchen display and order acceptance screens. This also covers the common search intent behind a delivery app tablet station, multiple restaurant delivery tablets, and a DoorDash Uber Eats tablet stand.</p>`,
      productGrid(p),
      `<h2>Where These Mounts Fit Best</h2>`,
      `<p><strong>Ghost kitchens and virtual brands:</strong> Use a 4 or 5 tablet station so staff can watch every order platform from one location.</p>`,
      `<p><strong>Full-service restaurants:</strong> Pair a 3-tablet delivery station near expo with a locking POS tablet stand at the host or checkout counter.</p>`,
      `<p><strong>Quick-service counters:</strong> Use a clamp or weighted POS setup where staff need tablets close but cannot give up prep space.</p>`,
      `<p><strong>Food trucks and pop-ups:</strong> Use a stable mount that keeps tablets away from hot surfaces and gives staff a readable angle in a tight workspace.</p>`,
      howToHtml(p),
      `<h2>Build the Station Around the Workflow</h2>`,
      `<p>A good restaurant tablet holder does not just hold hardware. It supports how orders move through the room. Put delivery app tablets where staff already check tickets, keep charging cables routed behind the mount, and leave one open position if your delivery stack may change.</p>`,
      `<p>Explore the <a href="${p.collectionUrl}">iBOLT restaurant and POS mounting collection</a> to compare Tablet Tower clamp mounts, wall mounts, locking tablet stands, and modular POS hardware.</p>`,
      faqHtml(p),
    ],
  },
  {
    key: "amps",
    title: "AMPS Mounting System and AMPS Mounting Plates",
    metaTitle: "AMPS Mounting System and AMPS Plates",
    metaDescription:
      "Understand AMPS mounting plates, 4-hole AMPS patterns, VESA adapters, ball mounts, and iBOLT modular mount compatibility.",
    slug: "amps-mounting-system-amps-mounting-plates",
    primaryKeywords: ["amps mounting plate", "amps mounting system", "AMPS mount"],
    collectionUrl: `${SITE}/collections/amps-pattern-mounts-and-adapters2`,
    products: [
      "25mm-1-inch-b-size-metal-amps-pattern-adapter-plate-ibpb-33890",
      "ibolt-25mm-1-inch-composite-amps-adapter-plate-dual-ball-socket-mounting-arms",
      "industry-standard-amps-packing-plate",
      "ibolt-amps-to-vesa-75-100-plate",
      "ibolt-universal-marine-electronics-mounting-plate",
      "ibolt-clamp-base-for-4-hole-amps-mounts",
    ],
    broll: null,
    howTo: {
      name: "How to choose an AMPS mounting plate",
      steps: [
        "Confirm whether the device uses the 4-hole AMPS pattern, VESA 75/100, 1/4-20 camera thread, or a ball mount.",
        "Choose an AMPS plate or adapter that matches the device side of the connection.",
        "Match the plate to a base style: drill base, clamp base, suction, magnetic, wall, or vehicle mount.",
        "Use the correct ball size for the device weight, with 25mm for many tablets and 38mm for heavier commercial setups.",
      ],
    },
    faqs: [
      [
        "What is an AMPS mounting plate?",
        "An AMPS mounting plate uses the common 4-hole AMPS pattern found in vehicle, fleet, marine, and electronics mounts. It lets holders, bases, and adapters bolt together without relying on a single brand ecosystem.",
      ],
      [
        "What does AMPS stand for in mounting systems?",
        "AMPS usually refers to the Accessory Mounting Pattern Standard. In practical terms, it means a standard 4-hole pattern used to connect device holders, plates, bases, and adapters.",
      ],
      [
        "Are AMPS mounts compatible with RAM and other ball mounts?",
        "Many AMPS plates can connect to RAM-style and other industry-standard ball systems when the ball size and bolt pattern match. iBOLT supports common sizes including 17mm, 20mm, 25mm, 38mm, and 57mm.",
      ],
      [
        "When should I use AMPS instead of VESA?",
        "Use AMPS for phones, tablets, camera adapters, small electronics, and vehicle mounting parts. Use VESA 75 or VESA 100 for monitors and screens that already have VESA holes.",
      ],
      [
        "Can an AMPS plate convert to a camera screw mount?",
        "Yes. iBOLT offers AMPS to 1/4-20 camera screw options for cameras, GoPro adapters, product photography rigs, and small accessories that use the standard tripod thread.",
      ],
    ],
    sections: (p) => [
      `<p>If you have ever tried to connect a tablet holder, camera adapter, vehicle base, or marine electronics plate and wondered why the holes almost line up, you have run into the reason AMPS exists. The <strong>AMPS mounting system</strong> gives installers a common 4-hole pattern so mounting parts can connect cleanly across vehicles, workstations, boats, forklifts, and custom builds.</p>`,
      `<p>For iBOLT customers, AMPS matters because it ties the modular system together. A good <strong>AMPS mounting plate</strong> can connect a holder to a drill base, a clamp base, a ball mount, a VESA adapter, or a 1/4-20 camera mount without forcing you to replace the entire setup.</p>`,
      `<h2>What the AMPS Pattern Does</h2>`,
      `<p>The AMPS pattern is a standard set of mounting holes used by many commercial device mounts. It is common in fleet vehicles, industrial equipment, GPS systems, tablet holders, and electronics brackets. When a holder and base both support AMPS, they can usually bolt together with the right hardware.</p>`,
      `<p>That sounds simple, but it changes how you buy mounting hardware. Instead of treating every mount as a sealed product, you can build a system from a base, arm, plate, and device holder. If the device changes, you replace the holder or adapter. If the mounting surface changes, you replace the base.</p>`,
      `<h2>AMPS Plates, VESA Plates, and Ball Mounts</h2>`,
      `<p>AMPS is not the only standard you will see. VESA 75 and VESA 100 are common on monitors. The 1/4-20 thread is common on cameras and tripods. Ball-and-socket joints are common in vehicle, marine, and industrial mounts. iBOLT uses adapters to connect these standards so one system can support phones, tablets, cameras, scanners, and screens. This is also where GPS mounting plate compatibility, 17mm 20mm 25mm ball mount compatibility, RAM compatible ball mounts, and AMPS phone mount fleet standard questions usually come from.</p>`,
      productGrid(p),
      `<h2>When to Use Each AMPS Part</h2>`,
      `<p><strong>AMPS to VESA plate:</strong> Use this when a monitor, display, or large screen has VESA 75 or VESA 100 holes but the base or arm is AMPS-based.</p>`,
      `<p><strong>Universal electronics mounting plate:</strong> Use this for marine electronics, small devices, and custom mounting surfaces where a simple plate solves the connection point.</p>`,
      `<p><strong>Clamp base for 4-hole AMPS mounts:</strong> Use this when you need AMPS compatibility but cannot drill into a counter, rail, shelf, or workbench.</p>`,
      `<p><strong>AMPS tablet or phone drill base:</strong> Use this when the device needs a fixed installed position in a vehicle, workstation, or business counter.</p>`,
      howToHtml(p),
      `<h2>Why AMPS Helps AI and Search Understand iBOLT</h2>`,
      `<p>AMPS is a technical entity, not just a keyword. When iBOLT pages explain AMPS plates, VESA adapters, 25mm and 38mm ball sizes, and device compatibility in plain language, AI systems can connect iBOLT with professional mounting standards instead of treating the brand as a generic phone holder seller.</p>`,
      `<p>Explore the <a href="${p.collectionUrl}">Build Your Own Mount configurator</a> when you know the device, surface, and ball size you need. It is the fastest way to turn an AMPS mounting requirement into an actual parts list.</p>`,
      faqHtml(p),
    ],
  },
  {
    key: "forklift",
    title: "Forklift Tablet Mounting Solutions",
    metaTitle: "Forklift Tablet Mounting Solutions",
    metaDescription:
      "Compare forklift tablet mounts, scanner holders, VESA monitor brackets, and warehouse device mounts built for material handling.",
    slug: "forklift-tablet-mounting-solutions",
    primaryKeywords: ["forklift tablet mount", "forklift mount", "warehouse tablet mount"],
    collectionUrl: `${SITE}/collections/heavy-duty-forklift-material-handling-tablet-mounts`,
    products: [
      "ibolt-tabdock-bizmount-pillar-mount-heavy-duty-forklift-tablet-mount-for-warehouse-vehicles-and-7-10-inch-tablets",
      "ibolt-lockprotm-incredibolttm-360-pillar-mount-heavy-duty-forklift-tablet-mount-for-warehouse-vehicles-and-7-10-inch-tablets",
      "ibolt-xl-forklift-barcode-scanner-holder-38mm-mount",
      "ibolt-xl-barcode-scanner-forklift-pillar-mount-for-warehouse-vehicles-inventory-management-and-material-handling",
      "ibolt-vesa-75x75-mm-100x100-mm-monitor-pillar-mount",
    ],
    broll: null,
    howTo: {
      name: "How to choose a forklift tablet mount",
      steps: [
        "Identify the device: tablet, scanner, monitor, or paired tablet and barcode scanner.",
        "Choose a pillar, overhead guard, magnetic, or VESA mounting location that does not block operator visibility.",
        "Use a heavier ball size, such as 38mm, when the device is large or exposed to vibration.",
        "Add locking hardware when tablets stay on shared equipment between shifts.",
      ],
    },
    faqs: [
      [
        "What is the best tablet mount for a forklift?",
        "A forklift tablet mount should attach to a pillar, overhead guard, or other strong location without blocking the operator's view. iBOLT's forklift tablet mounts are built around heavy-duty arms, locking options, and warehouse device holders.",
      ],
      [
        "Can I mount a barcode scanner on a forklift?",
        "Yes. iBOLT offers XL barcode scanner mounts designed for warehouse vehicles and material handling workflows. Scanner mounts can be paired with tablet mounts when operators need both devices within reach.",
      ],
      [
        "Should forklift mounts be magnetic or clamped?",
        "Clamp and pillar mounts are better for fixed high-vibration use. Magnetic mounts can work when the surface is steel, flat, and appropriate for the load, but they should be chosen carefully for warehouse safety.",
      ],
      [
        "Do forklift tablet mounts work with warehouse management systems?",
        "The mount holds the hardware, so it can support tablets running common WMS, inventory, picking, and scanning apps as long as the tablet size fits the holder.",
      ],
      [
        "What ball size is best for forklift mounting?",
        "Many forklift and warehouse setups use larger 38mm or 57mm ball systems because tablets, monitors, and scanners face more vibration than light phone mounts.",
      ],
    ],
    sections: (p) => [
      `<p>Forklift operators do not have spare space. A tablet balanced on a seat, a scanner rolling around the cab, or a monitor bolted into the wrong sightline can slow picks and create safety problems. A proper <strong>forklift tablet mount</strong> keeps the device where the operator can read it, reach it, and leave it secured between shifts.</p>`,
      `<p>iBOLT's warehouse mounting lineup is built for material handling, inventory, barcode scanning, and rugged mobile workflows. The goal is simple: mount tablets, scanners, and monitors without turning the forklift into a cluttered workstation.</p>`,
      `<h2>Start With the Device and the Mounting Location</h2>`,
      `<p>A warehouse tablet mount should be chosen around the actual equipment. A 7 to 10 inch tablet running WMS software needs a different holder than a VESA monitor or an XL barcode scanner. The mounting location matters just as much. Forklift pillar mounts are common because they keep devices close without drilling into dashboard plastics or blocking the windshield.</p>`,
      `<p>For shared forklifts, locking tablet holders are worth considering. For scanner-heavy operations, a dedicated scanner holder can keep barcode hardware from disappearing into bins, seats, or cup holders. This page should also answer forklift cage tablet holder, scanner holder for forklift, warehouse tablet mount, forklift barcode scanner mount, and VESA forklift display mount searches.</p>`,
      productGrid(p),
      `<h2>Forklift Tablet Mount Options</h2>`,
      `<p><strong>Pillar tablet mounts:</strong> These are a strong starting point for most warehouse vehicles because they clamp to existing structure and keep the tablet close to the operator.</p>`,
      `<p><strong>Locking tablet mounts:</strong> Use these for shared forklifts, high-value tablets, and facilities where devices stay mounted after a shift change.</p>`,
      `<p><strong>Barcode scanner mounts:</strong> Use these when scanner access is part of every pick. The XL scanner holder is built for warehouse vehicles and helps prevent scanner damage or loss.</p>`,
      `<p><strong>VESA monitor mounts:</strong> Use VESA 75 or VESA 100 brackets for larger screens and fixed vehicle displays.</p>`,
      `<h2>Decision Matrix for Warehouse Installs</h2>`,
      `<p>Use a pillar tablet mount when the tablet is the main WMS screen. Use a scanner holder when operators need a predictable place to return barcode hardware between picks. Use a VESA mount when the equipment uses a fixed monitor or larger display. Use locking hardware when devices stay mounted during breaks, shift changes, or shared-equipment handoffs.</p>`,
      `<p>That decision matrix keeps the page from duplicating older forklift comparison posts. The hub should help warehouse buyers choose the install type first, then click through to the exact product or collection that fits their forklift cage, scanner workflow, tablet size, and display pattern.</p>`,
      howToHtml(p),
      `<h2>Build Around Visibility and Safety</h2>`,
      `<p>Do not place a tablet where it blocks forks, pallet corners, pedestrians, or racking. The best forklift mount sits in the operator's normal reach zone while preserving the view through the cage and mast area. Cable routing should be tight enough to stay clear of controls and moving parts.</p>`,
      `<p>Browse the <a href="${p.collectionUrl}">iBOLT material handling and warehouse mount collection</a> to compare forklift tablet mounts, scanner holders, VESA brackets, and heavy-duty clamp bases.</p>`,
      faqHtml(p),
    ],
  },
  {
    key: "fleet",
    title: "Fleet and ELD Mounting Systems",
    metaTitle: "Fleet and ELD Mounting Systems",
    metaDescription:
      "Standardize fleet and ELD tablet mounting with suction, drill base, seat rail, locking, phone, and tablet mounts for commercial vehicles.",
    slug: "fleet-eld-mounting-systems",
    primaryKeywords: ["ELD mount", "fleet mounting solutions", "fleet tablet mount"],
    collectionUrl: `${SITE}/collections/fleet-heavy-duty-eld-mandate-mounts`,
    products: [
      "ibolt-tabdocktm-incredibolttm-360-suction-heavy-duty-metal-6-inch-multi-angle-mount-for-all-7-10-tablets-for-commercial-vehicles-trucks-and-eld-devices",
      "ibolt-tabdock-incredibolt-360-heavy-duty-triple-suction-cup-mount",
      "ibolt-lockpro-flexpro-heavy-duty-locking-tablet-seat-rail-mount",
      "ibolt-tabdock-flexpro-heavy-duty-seat-rail-gooseneck-tablet-eld-floor-mount-ibbz-33762",
      "xprodock-bizmount-amps-smartphone-drill-base-mount-ibbz-33931",
    ],
    broll: {
      src: uploadedBroll.fleet,
      alt: "Fleet vehicle dashboard with commercial tablet and phone mounting setup",
      reason:
        "Fleet buyers need to see device placement inside commercial vehicles, not only isolated product photos.",
    },
    howTo: {
      name: "How to standardize fleet and ELD mounts",
      steps: [
        "List the tablets, phones, ELD devices, scanners, and chargers used in each vehicle class.",
        "Choose approved mount positions that keep screens readable without blocking visibility or controls.",
        "Standardize the base type by vehicle group, such as suction, seat rail, drill base, or AMPS.",
        "Document the parts list so replacements and new vehicle installs use the same hardware.",
      ],
    },
    faqs: [
      [
        "What is an ELD mount?",
        "An ELD mount holds the tablet or device used for electronic logging and fleet workflows inside a commercial vehicle. It should position the screen where the driver can read it safely without blocking the windshield or controls.",
      ],
      [
        "Should a fleet use suction, drill base, or seat rail mounts?",
        "Suction mounts are useful when vehicles rotate or leases prevent drilling. Drill base and AMPS mounts are better for permanent installs. Seat rail mounts work well when dashboards cannot be modified.",
      ],
      [
        "Can iBOLT mounts be standardized across a whole fleet?",
        "Yes. iBOLT's modular system lets fleet managers standardize holders, arms, and base types by vehicle class while still adapting to different dashboards and cabins.",
      ],
      [
        "Do fleet tablet mounts need to lock?",
        "Locking mounts are recommended for shared trucks, high-value tablets, and vehicles where devices stay installed overnight or between drivers.",
      ],
      [
        "Are iBOLT fleet mounts compatible with RAM-style hardware?",
        "Many iBOLT components use industry-standard ball sizes and AMPS patterns, so they can often integrate with existing commercial mounting hardware when sizes match.",
      ],
    ],
    sections: (p) => [
      `<p>A fleet mount is not just a place to put a tablet. In a delivery van, service truck, or semi cab, that mount affects driver visibility, ELD access, charging, inspection readiness, and how often hardware gets damaged. Loose devices are easy to drop. Badly placed devices are harder to read. Mixed hardware across vehicles makes replacements a headache.</p>`,
      `<p>iBOLT fleet and <strong>ELD mounting systems</strong> are built for companies that need repeatable installs across multiple vehicles, not one-off consumer holders. These <strong>fleet mounting solutions</strong> can support tablets, phones, AMPS drill bases, suction mounts, seat rail mounts, and locking tablet holders.</p>`,
      heroImage(p, "fleet"),
      `<h2>Why Standardization Matters</h2>`,
      `<p>Fleet managers usually have two problems at once: every vehicle cab is slightly different, and every driver still needs the device in a predictable place. Standardizing the mount family solves that. You can choose approved base types by vehicle class while keeping holders, arms, chargers, and replacement parts consistent.</p>`,
      `<p>That matters for ELD tablets, proof-of-delivery phones, route-navigation devices, and inspection apps. If a device fails or a mount gets worn, the maintenance team should know exactly which part to reorder. This page should speak directly to FMCSA ELD mount, fleet truck tablet mount, truck tablet mounting solution, fleet phone mount standardization, and phone mounts for 25 vehicle fleet searches.</p>`,
      productGrid(p),
      `<h2>Choose by Vehicle and Install Type</h2>`,
      `<p><strong>Suction fleet mounts:</strong> Good for temporary vehicles, rentals, leased vans, and installs where drilling is not allowed.</p>`,
      `<p><strong>Seat rail mounts:</strong> Useful when the dashboard is crowded or when a tablet needs to sit lower without permanent drilling.</p>`,
      `<p><strong>AMPS drill base mounts:</strong> Best for permanent phone or tablet installs in fleet vehicles where repeatable placement matters.</p>`,
      `<p><strong>Locking tablet mounts:</strong> Important for shared trucks, high-value tablets, and overnight parking situations.</p>`,
      `<h2>Fleet Rollout Checklist</h2>`,
      `<p>Before ordering mounts across a fleet, group vehicles by cab layout and device loadout. A semi tractor, cargo van, service pickup, and delivery car may all need different base styles, but they can still share the same tablet holder family and replacement parts strategy. Document the approved install zone, cable path, base type, arm length, holder, and spare parts for each group.</p>`,
      `<p>This also gives the SEO page a stronger operational purpose. It answers how to roll out a fleet standard, not just which single ELD holder to buy.</p>`,
      howToHtml(p),
      `<h2>Make the Mount Part of the Fleet Spec</h2>`,
      `<p>The best time to decide on a fleet mount is before vehicles are deployed. Put the approved mount, base, arm, holder, charging route, and install position into the vehicle spec. That gives drivers a consistent cab layout and gives maintenance one replacement path.</p>`,
      `<p>Compare options in the <a href="${p.collectionUrl}">iBOLT fleet and ELD mount collection</a> or use the build-your-own flow for mixed vehicle deployments.</p>`,
      faqHtml(p),
    ],
  },
  {
    key: "streaming",
    title: "Live Streaming Phone and Camera Mounts",
    metaTitle: "Live Streaming Phone and Camera Mounts",
    metaDescription:
      "Find phone stands for live streaming, table camera mounts, overhead rigs, clamp mounts, and camera screw adapters for creators.",
    slug: "live-streaming-phone-camera-mounts",
    primaryKeywords: [
      "best phone stand for live streaming",
      "phone stand for streaming",
      "table camera mount",
    ],
    collectionUrl: `${SITE}/collections/live-streaming-live-streaming-phone-mounts`,
    products: [
      "ibolt-stream-cast-creator-custom-mount-kit-with-over-60-variations-live-streaming-tutorial-videos-ibsc-34615",
      "ibolttm-stream-cast-incredibolttm-stand-adjustable-overhead-phone-mount",
      "ibolt-stream-cast-overhead-camera-rig-desk-mount-for-dslr-cameras-for-top-down-and-front-facing-photography",
      "phone-tablet-slide-bar-camera-screw-tripod-attachment-ibcm-34603",
      "ibolt-1-4-20-camera-screw-incredibolt-suction-cup-mount-secure-adjustable-mount-for-cameras-accessories",
    ],
    broll: null,
    howTo: {
      name: "How to choose a live streaming mount",
      steps: [
        "Decide whether the camera needs front-facing, overhead, side-angle, or product-table positioning.",
        "Match the device connection: phone holder, GoPro adapter, or 1/4-20 camera screw.",
        "Choose a table, clamp, suction, or overhead rig based on the shooting surface.",
        "Test the angle with lights and cables connected before recording the final setup.",
      ],
    },
    faqs: [
      [
        "What is the best phone stand for live streaming?",
        "The best phone stand for live streaming depends on the shot. Use an overhead phone mount for cooking, art, product demos, and unboxing. Use a front-facing stand or clamp mount when the creator needs to speak directly to the camera.",
      ],
      [
        "What is a table camera mount used for?",
        "A table camera mount holds a camera, phone, or action camera over or beside a work surface. It is useful for product videos, tutorials, live sales, overhead cooking shots, and hands-on demonstrations.",
      ],
      [
        "Can I mount a DSLR camera for overhead videos?",
        "Yes, but the mount needs to support the camera weight and use a 1/4-20 camera screw connection. The iBOLT Stream-Cast Overhead Camera Rig is built for top-down and front-facing camera setups.",
      ],
      [
        "Do phone streaming mounts work for TikTok, YouTube, and Instagram?",
        "The mount holds the phone or camera, so it can support any platform that runs on the device. Choose the mount by device size, shooting angle, and table or desk layout.",
      ],
      [
        "Should creators use a clamp mount or a freestanding mount?",
        "Clamp mounts save desk space and stay fixed to a table, shelf, rail, or rig. Freestanding mounts are easier to move and work better when the setup changes often.",
      ],
    ],
    sections: (p) => [
      `<p>A live stream falls apart fast when the phone starts sliding, the camera angle changes mid-shot, or the table tripod gets in the way of your hands. Creators do not just need a phone holder. They need a mount that matches the way they shoot: overhead product demos, cooking videos, craft tutorials, live selling, front-facing commentary, or multi-camera desk setups.</p>`,
      `<p>This guide covers <strong>live streaming phone and camera mounts</strong>, including the <strong>best phone stand for live streaming</strong>, table camera mount options, overhead rigs, clamp mounts, and 1/4-20 camera screw adapters.</p>`,
      `<h2>Match the Mount to the Shot</h2>`,
      `<p><strong>Overhead shots:</strong> Use these for cooking, product videos, unboxing, repair work, art, and any scene where the audience needs to see the table.</p>`,
      `<p><strong>Front-facing shots:</strong> Use these for teaching, sales videos, webinars, and talking-head live streams.</p>`,
      `<p><strong>Side-angle shots:</strong> Use these for process videos where the viewer needs depth, hands, and a product in frame.</p>`,
      `<p><strong>Action camera angles:</strong> Use GoPro-style or 1/4-20 adapters when the camera needs a compact mount on a rail, clamp, or alternate angle.</p>`,
      productGrid(p),
      `<h2>Phone Stand for Streaming vs Table Camera Mount</h2>`,
      `<p>A <strong>phone stand for streaming</strong> works best when the phone is the primary camera. It should hold the device steady, leave room for charging, and allow portrait or landscape framing.</p>`,
      `<p>A <strong>table camera mount</strong> is usually heavier and more adjustable. It may use a 1/4-20 screw for DSLR, mirrorless, or compact cameras. If the camera is heavier than a phone, choose a mount with stronger arms and a stable base.</p>`,
      `<h2>Use Modular Parts for Multi-Camera Setups</h2>`,
      `<p>Creators often start with one phone and then add a second angle, overhead camera, or action camera. iBOLT's modular system helps because holders, arms, adapters, and bases can be swapped as the setup grows. A 1/4-20 camera screw adapter can connect cameras and accessories to the same family of mounting parts. This is the hub for two phone streaming setup, camera arm for livestream desk, 1/4-20 camera mount overhead, TikTok Shop overhead camera mount, and Etsy product video overhead rig searches.</p>`,
      howToHtml(p),
      `<h2>Build for Repeatability</h2>`,
      `<p>The best live streaming setup is one you can rebuild quickly. Mark the mount location, keep cables routed, and use the same angle for recurring videos. That helps product demos, tutorials, and live selling events look consistent without rebuilding the desk every time.</p>`,
      `<p>Explore the <a href="${p.collectionUrl}">iBOLT live streaming and camera mount collection</a> to compare phone stands, overhead rigs, clamp mounts, and camera screw adapters.</p>`,
      faqHtml(p),
    ],
  },
  {
    key: "clamp-guide",
    title: "Phone Clamp, Clip, Screw, Ball, and Socket Mount Guide",
    metaTitle: "Phone Clamp, Clip, Screw, Ball Mount Guide",
    metaDescription:
      "Understand phone clamp mounts, clip-on phone mounts, screw bases, ball mounts, socket arms, and modular device mounting parts.",
    slug: "phone-clamp-clip-screw-ball-socket-mount-guide",
    primaryKeywords: ["phone clamp", "clamp mount", "clip on phone mount"],
    collectionUrl: `${SITE}/collections/phone-c-clamp-mounts`,
    products: [
      "ibolt-17mm-clamp-mount-for-handlebars-poles-posts-compatible-with-garmin-gps-systems-and-ibolt-smartphone-holders",
      "25mm-1-inch-ball-b-size-adjustable-clamp-mount-22174",
      "1-inch-25mm-b-size-ball-1-4-20-camera-screw-mount-adapter",
      "ibolt-spro2-grip-compact-clamp-mount",
      "ibolt-moto-vise-incredibolt-heavy-duty-phone-clamp-handlebar-rail-mount",
    ],
    broll: {
      localSrc: "../assets/modular-clamp-components-broll.png",
      alt: "Workbench with phone clamps, screw bases, ball mounts, and socket arms",
      reason:
        "This guide explains component families, so a neutral workbench b-roll image makes the differences easier to scan before looking at specific SKUs.",
      generated: true,
    },
    howTo: {
      name: "How to choose between clamp, clip, screw, ball, and socket mounts",
      steps: [
        "Pick the surface first: rail, post, desk edge, dashboard, wall, cage, or flat panel.",
        "Choose the base style that matches the surface: clamp, clip, screw-down, suction, magnetic, or AMPS plate.",
        "Match the ball size and socket arm to the device weight and vibration level.",
        "Choose the holder last so it fits the phone, case, tablet, camera, or scanner.",
      ],
    },
    faqs: [
      [
        "What is a phone clamp mount?",
        "A phone clamp mount grips a rail, post, handlebar, desk edge, or other structure, then connects to a phone holder through a ball-and-socket arm or direct adapter.",
      ],
      [
        "Is a clip-on phone mount the same as a clamp mount?",
        "Not always. A clip-on phone mount is usually lighter and made for temporary use. A clamp mount normally uses a tightening mechanism and is better for work vehicles, rails, desks, and equipment.",
      ],
      [
        "When should I use a screw mount?",
        "Use a screw-down or drill-base mount when the device needs a permanent, repeatable position and the surface can be drilled safely.",
      ],
      [
        "What is a ball and socket mount?",
        "A ball and socket mount uses a round ball connection and a tightening arm so the device angle can be adjusted. Common ball sizes include 17mm, 20mm, 25mm, 38mm, and 57mm.",
      ],
      [
        "Can one phone holder work with different mount bases?",
        "Yes, when the holder and base use compatible ball sizes or adapters. That is why modular iBOLT parts can move between clamps, suction bases, drill bases, and AMPS hardware.",
      ],
    ],
    sections: (p) => [
      `<p>Mounting terms get messy fast. One product says <strong>phone clamp</strong>, another says <strong>clamp mount</strong>, a third says <strong>clip on phone mount</strong>, and then you see screw bases, ball mounts, socket arms, AMPS plates, and adapters. They are related, but they are not the same.</p>`,
      `<p>This guide explains the parts in plain language so you can choose the right mounting setup for a phone, tablet, camera, scanner, GPS, or accessory without guessing.</p>`,
      heroImage(p, "clamp-guide"),
      `<h2>Start With the Base</h2>`,
      `<p>The base is the part that attaches to the real world. A clamp base grips a rail, pole, desk edge, handlebar, forklift pillar, or shelf. A clip-on phone mount usually attaches faster but is lighter and less secure. A screw-down base bolts to a surface for a permanent install. A suction base attaches to glass or smooth surfaces. A magnetic base works only when the surface is compatible with the load and use case.</p>`,
      `<p>If the base is wrong, the rest of the mount does not matter. Choose the surface first, then the base.</p>`,
      `<h2>Ball and Socket Mounts Explained</h2>`,
      `<p>The ball-and-socket joint is what lets the device angle change. The ball size controls compatibility and strength. Smaller 17mm and 20mm balls are common for light phone and GPS setups. A 25mm ball is a popular general-purpose size. Larger 38mm and 57mm balls are used for heavier tablets, monitors, forklifts, and industrial environments.</p>`,
      `<p>A socket arm tightens around the ball. That gives you adjustability without having to drill new holes every time the screen angle changes.</p>`,
      productGrid(p),
      `<h2>Clamp, Clip, Screw, and AMPS: Which One Do You Need?</h2>`,
      `<p><strong>Use a clamp mount</strong> when you need a firm grip on a rail, pole, shelf, desk, handlebar, or equipment frame without drilling.</p>`,
      `<p><strong>Use a clip on phone mount</strong> when the setup is temporary, lightweight, and low vibration. Use a heavier phone clamp mount for delivery drivers, clamp phone mount for delivery work, and any phone mount that will not fall off under vibration.</p>`,
      `<p><strong>Use a screw or drill base</strong> when the device needs a permanent home and the surface can be drilled safely.</p>`,
      `<p><strong>Use an AMPS plate</strong> when you need to connect standardized mounting hardware, adapters, holders, and bases.</p>`,
      howToHtml(p),
      `<h2>Why Modular Parts Matter</h2>`,
      `<p>Modular mounting lets you reuse what still works. If the phone changes, replace the holder. If the vehicle changes, replace the base. If the angle changes, replace the arm. iBOLT's 300+ parts are built around that idea, with standard ball sizes, AMPS patterns, camera screw adapters, and device holders that can be combined for the actual surface and device.</p>`,
      `<p>Use the <a href="${p.collectionUrl}">Build Your Own Mount configurator</a> to select the base, arm, and holder that match your setup.</p>`,
      faqHtml(p),
    ],
  },
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeImage(url) {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function productUrl(handle) {
  return `${SITE}/products/${handle}`;
}

function cartUrl(product) {
  return product.variantId ? `${SITE}/cart/add?id=${product.variantId}&quantity=1` : product.url;
}

function cleanTitle(title) {
  return String(title || "")
    .replace(/™|®/g, "")
    .replace(/[’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function money(price) {
  const n = Number(price);
  return Number.isFinite(n) ? `$${n.toFixed(2).replace(/\.00$/, "")}` : "";
}

async function fetchProduct(handle) {
  const fallback = fallbackProducts[handle];
  try {
    const response = await fetch(`${productUrl(encodeURIComponent(handle))}.js`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();
    const firstVariant = Array.isArray(raw.variants) ? raw.variants[0] : null;
    return {
      handle,
      title: cleanTitle(raw.title || fallback?.title || handle),
      price: raw.price ? Number(raw.price) / 100 : fallback?.price,
      variantId: firstVariant?.id || fallback?.variantId || null,
      available: firstVariant?.available !== false,
      image: normalizeImage(raw.featured_image || raw.images?.[0] || fallback?.image),
      url: productUrl(handle),
    };
  } catch {
    return {
      handle,
      title: cleanTitle(fallback?.title || handle),
      price: fallback?.price,
      variantId: fallback?.variantId || null,
      available: true,
      image: normalizeImage(fallback?.image),
      url: productUrl(handle),
      fallback: true,
    };
  }
}

function productCard(product) {
  const price = money(product.price);
  const image = product.image
    ? `<a href="${product.url}"><img src="${product.image}" alt="${escapeHtml(product.title)}" loading="lazy"></a>`
    : "";
  return `<div class="aeo-product-card">
  ${image}
  <h3><a href="${product.url}">${escapeHtml(product.title)}</a></h3>
  ${price ? `<p class="price">${price}</p>` : ""}
  <div class="aeo-card-actions">
    <a class="aeo-product-link aeo-product-link-secondary" href="${product.url}">View Product</a>
    ${product.variantId ? `<a class="aeo-product-link aeo-product-link-primary" href="${cartUrl(product)}">Add to Cart</a>` : ""}
  </div>
</div>`;
}

function productGrid(page) {
  const products = page.resolvedProducts || [];
  return `<h2>Featured iBOLT Options</h2>
<div class="aeo-product-grid">
${products.slice(0, 5).map(productCard).join("\n")}
</div>`;
}

function heroImage(page, key) {
  const broll = page.broll;
  if (!broll) return "";
  const src = broll.src || broll.localSrc;
  return `<figure class="aeo-hero-image">
  <img src="${src}" alt="${escapeHtml(broll.alt)}" loading="lazy">
  <figcaption>${escapeHtml(broll.alt)}</figcaption>
</figure>`;
}

function howToHtml(page) {
  if (!page.howTo) return "";
  return `<h2>${escapeHtml(page.howTo.name)}</h2>
<ol class="aeo-steps">
${page.howTo.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("\n")}
</ol>`;
}

function faqHtml(page) {
  return `<h2>Frequently Asked Questions</h2>
${page.faqs
  .map(
    ([question, answer]) => `<h3>${escapeHtml(question)}</h3>
<p>${escapeHtml(answer)}</p>`,
  )
  .join("\n")}`;
}

function pageBody(page) {
  const body = page.sections(page).filter(Boolean).join("\n");
  return `<section class="aeo-solution-page" data-solution-page="${page.key}">
<p class="aeo-updated">Last updated: June 2026</p>
<h1>${escapeHtml(page.title)}</h1>
${body}
</section>`;
}

function styleBlock() {
  return `<style>
.aeo-solution-page { max-width: 1120px; margin: 0 auto; line-height: 1.65; color: #222; }
.aeo-solution-page h1 { font-size: clamp(2rem, 4vw, 3.25rem); line-height: 1.08; margin: 0 0 1rem; letter-spacing: 0; }
.aeo-solution-page h2 { font-size: 1.6rem; line-height: 1.2; margin: 2.4rem 0 0.9rem; letter-spacing: 0; }
.aeo-solution-page h3 { font-size: 1.08rem; line-height: 1.3; margin: 1.1rem 0 0.35rem; letter-spacing: 0; }
.aeo-solution-page p { margin: 0 0 1rem; }
.aeo-updated { color: #666; font-size: 0.9rem; margin-bottom: 1rem; }
.aeo-hero-image { margin: 1.75rem 0; }
.aeo-hero-image img { width: 100%; max-height: 460px; object-fit: cover; border-radius: 8px; display: block; }
.aeo-hero-image figcaption { color: #666; font-size: 0.9rem; margin-top: 0.45rem; }
.aeo-product-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; margin: 1rem 0 1.5rem; }
.aeo-product-card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 14px; background: #fff; }
.aeo-product-card img { width: 100%; aspect-ratio: 1 / 1; object-fit: contain; display: block; margin-bottom: 0.75rem; }
.aeo-product-card h3 { font-size: 1rem; min-height: 3.8em; margin-top: 0; }
.aeo-product-card .price { font-weight: 700; margin-bottom: 0.75rem; }
.aeo-card-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.aeo-card-actions .aeo-product-link { display: inline-flex; align-items: center; justify-content: center; min-height: 40px; padding: 0 14px; border-radius: 6px; border: 1px solid #101827; background: #101827; background-image: none !important; box-shadow: none !important; color: #fff !important; text-decoration: none !important; font-weight: 700; font-size: 0.92rem; line-height: 1.2; position: relative; }
.aeo-card-actions .aeo-product-link::before,
.aeo-card-actions .aeo-product-link::after { content: none !important; display: none !important; }
.aeo-card-actions .aeo-product-link-secondary { background: #fff !important; color: #111 !important; }
.aeo-steps { padding-left: 1.25rem; }
.aeo-steps li { margin-bottom: 0.6rem; }
@media (max-width: 640px) {
  .aeo-card-actions .aeo-product-link { width: 100%; }
  .aeo-product-card h3 { min-height: 0; }
}
</style>`;
}

function graphForPage(page) {
  const canonical = `${SITE}/pages/${page.slug}`;
  const orgId = `${SITE}/#organization`;
  const pageId = `${canonical}#webpage`;
  const faqId = `${canonical}#faq`;
  const howToId = `${canonical}#howto`;
  const graph = [
    {
      "@type": "Organization",
      "@id": orgId,
      name: "iBOLT Mounts",
      url: SITE,
      sameAs: [
        "https://www.facebook.com/iBOLTMounts/",
        "https://www.instagram.com/iboltmounts/",
        "https://www.pinterest.com/iBOLTMounts/",
        "https://www.youtube.com/channel/UCf8Ah8orl0Ek3XcjC7sWWOA",
        "https://www.tiktok.com/@iboltmounts",
      ],
      knowsAbout: [
        "phone mounts",
        "tablet mounts",
        "fleet mounting systems",
        "ELD mounts",
        "forklift tablet mounts",
        "AMPS mounting plates",
        "restaurant tablet mounts",
        "live streaming camera mounts",
      ],
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${canonical}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE },
        { "@type": "ListItem", position: 2, name: "Solutions", item: `${SITE}/pages` },
        { "@type": "ListItem", position: 3, name: page.title, item: canonical },
      ],
    },
    {
      "@type": "WebPage",
      "@id": pageId,
      url: canonical,
      name: page.metaTitle,
      description: page.metaDescription,
      isPartOf: { "@id": `${SITE}/#website` },
      about: page.primaryKeywords,
      publisher: { "@id": orgId },
      breadcrumb: { "@id": `${canonical}#breadcrumb` },
      mainEntity: [{ "@id": faqId }, ...(page.howTo ? [{ "@id": howToId }] : [])],
    },
    {
      "@type": "FAQPage",
      "@id": faqId,
      mainEntity: page.faqs.map(([question, answer]) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: {
          "@type": "Answer",
          text: answer,
        },
      })),
    },
    ...page.resolvedProducts.map((product) => ({
      "@type": "Product",
      "@id": `${product.url}#product`,
      name: product.title,
      image: product.image ? [product.image] : undefined,
      url: product.url,
      brand: { "@id": orgId },
      offers:
        Number.isFinite(Number(product.price)) && product.available !== undefined
          ? {
              "@type": "Offer",
              url: product.url,
              priceCurrency: "USD",
              price: String(Number(product.price).toFixed(2)),
              availability: product.available
                ? "https://schema.org/InStock"
                : "https://schema.org/OutOfStock",
            }
          : undefined,
    })),
  ];

  if (page.howTo) {
    graph.push({
      "@type": "HowTo",
      "@id": howToId,
      name: page.howTo.name,
      step: page.howTo.steps.map((text, index) => ({
        "@type": "HowToStep",
        position: index + 1,
        text,
      })),
    });
  }

  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

function schemaScript(schema) {
  return `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
}

function previewHtml(page, body, schema) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.metaTitle)}</title>
  <meta name="description" content="${escapeHtml(page.metaDescription)}">
  ${styleBlock()}
  <style>
    body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 32px 20px 60px; background: #f7f8fa; }
    .review-shell { max-width: 1180px; margin: 0 auto; background: #fff; border-radius: 8px; padding: clamp(20px, 4vw, 48px); box-shadow: 0 1px 12px rgba(0,0,0,0.08); }
    .review-meta { max-width: 1120px; margin: 0 auto 24px; padding: 14px 16px; border: 1px solid #ddd; border-radius: 8px; background: #fff; font-size: 14px; color: #333; }
  </style>
  ${schemaScript(schema)}
</head>
<body>
  <div class="review-meta">
    <strong>Review draft only.</strong> Proposed live URL: <a href="${SITE}/pages/${page.slug}">${SITE}/pages/${page.slug}</a><br>
    Meta title: ${escapeHtml(page.metaTitle)}<br>
    Meta description: ${escapeHtml(page.metaDescription)}<br>
    Target weak keywords: ${page.primaryKeywords.map(escapeHtml).join(", ")}
  </div>
  <main class="review-shell">
    ${body}
  </main>
</body>
</html>`;
}

function markdownForPage(page) {
  return `# ${page.title}

Meta title: ${page.metaTitle}
Meta description: ${page.metaDescription}
Proposed slug: ${page.slug}
Target keywords: ${page.primaryKeywords.join(", ")}
Collection URL: ${page.collectionUrl}

Products:
${page.resolvedProducts
  .map((product) => `- ${product.title}: ${product.url} (${money(product.price)})`)
  .join("\n")}

FAQ:
${page.faqs.map(([q, a]) => `- ${q}\n  ${a}`).join("\n")}

B-roll:
${page.broll ? `- Reason: ${page.broll.reason}\n- Source: ${page.broll.src || page.broll.localSrc}` : "- Not needed beyond product images."}
`;
}

function validationForPage(page, body, schema) {
  const text = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const missingKeywords = page.primaryKeywords.filter((keyword) => !lower.includes(keyword.toLowerCase()));
  const productLinks = page.resolvedProducts.filter((product) => body.includes(product.url)).length;
  const graphTypes = schema["@graph"].map((node) => node["@type"]);
  const requiredTypes = ["Organization", "WebPage", "FAQPage", "Product"];
  if (page.howTo) requiredTypes.push("HowTo");
  const missingTypes = requiredTypes.filter((type) => !graphTypes.includes(type));
  const banned = [
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
    "look no further",
  ].filter((phrase) => lower.includes(phrase));

  return {
    slug: page.slug,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    productLinks,
    productCards: page.resolvedProducts.length,
    faqCount: page.faqs.length,
    missingKeywords,
    missingSchemaTypes: missingTypes,
    bannedPhrases: banned,
    hasBroll: Boolean(page.broll),
    pass: missingKeywords.length === 0 && missingTypes.length === 0 && banned.length === 0 && productLinks > 0,
  };
}

async function ensureDirs() {
  for (const dir of ["assets", "markdown", "pages", "preview", "schema", "validation", "payloads"]) {
    await mkdir(path.join(OUT_DIR, dir), { recursive: true });
  }
}

async function copyAssets() {
  if (existsSync(GENERATED_CLAMP_BROLL)) {
    await copyFile(GENERATED_CLAMP_BROLL, path.join(OUT_DIR, "assets/modular-clamp-components-broll.png"));
  }
  const localBroll = [
    ["restaurant-delivery-apps-broll.png", "restaurant-delivery-apps-broll.png"],
    ["forklift-tablet-scanner-broll.png", "forklift-tablet-scanner-broll.png"],
    ["eld-tablet-mount-broll.png", "eld-tablet-mount-broll.png"],
    ["overhead-livestream-broll.png", "overhead-livestream-broll.png"],
    ["amps-vesa-ball-sizes-broll.png", "amps-vesa-ball-sizes-broll.png"],
  ];
  for (const [sourceName, targetName] of localBroll) {
    const src = path.resolve("content-output/review-drafts/broll", sourceName);
    if (existsSync(src)) {
      await copyFile(src, path.join(OUT_DIR, "assets", targetName));
    }
  }
}

async function main() {
  await ensureDirs();
  await copyAssets();

  const resolvedProducts = Object.fromEntries(
    await Promise.all(handles.map(async (handle) => [handle, await fetchProduct(handle)])),
  );

  const manifest = {
    generatedAt: new Date().toISOString(),
    outputDir: OUT_DIR,
    mode: "review-only",
    note: "No Shopify publish or page mutation was performed.",
    pages: [],
  };
  const validations = [];

  for (const page of pages) {
    page.resolvedProducts = page.products.map((handle) => resolvedProducts[handle]).filter(Boolean);
    const body = pageBody(page);
    const schema = graphForPage(page);
    const shopifyBody = `${styleBlock()}\n${body}\n${schemaScript(schema)}`;
    const preview = previewHtml(page, body, schema);
    const validation = validationForPage(page, body, schema);
    validations.push(validation);

    await writeFile(path.join(OUT_DIR, "pages", `${page.slug}.shopify-page.html`), shopifyBody);
    await writeFile(path.join(OUT_DIR, "preview", `${page.slug}.html`), preview);
    await writeFile(path.join(OUT_DIR, "schema", `${page.slug}.json`), JSON.stringify(schema, null, 2));
    await writeFile(path.join(OUT_DIR, "markdown", `${page.slug}.md`), markdownForPage(page));
    await writeFile(path.join(OUT_DIR, "validation", `${page.slug}.json`), JSON.stringify(validation, null, 2));
    await writeFile(
      path.join(OUT_DIR, "payloads", `${page.slug}.shopify-page-payload.json`),
      JSON.stringify(
        {
          page: {
            title: page.title,
            handle: page.slug,
            body_html: shopifyBody,
            published: false,
            metafields: [
              {
                namespace: "global",
                key: "title_tag",
                value: page.metaTitle,
                type: "single_line_text_field",
              },
              {
                namespace: "global",
                key: "description_tag",
                value: page.metaDescription,
                type: "single_line_text_field",
              },
            ],
          },
        },
        null,
        2,
      ),
    );

    manifest.pages.push({
      title: page.title,
      slug: page.slug,
      proposedUrl: `${SITE}/pages/${page.slug}`,
      preview: `preview/${page.slug}.html`,
      shopifyBody: `pages/${page.slug}.shopify-page.html`,
      schema: `schema/${page.slug}.json`,
      targetKeywords: page.primaryKeywords,
      collectionUrl: page.collectionUrl,
      products: page.resolvedProducts.map((product) => ({
        title: product.title,
        url: product.url,
        price: product.price,
        variantId: product.variantId,
      })),
      broll: page.broll || null,
      validation,
    });
  }

  await writeFile(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(OUT_DIR, "validation", "summary.json"), JSON.stringify(validations, null, 2));
  await writeFile(
    path.join(OUT_DIR, "SCHEMA_IMPLEMENTATION_NOTES.md"),
    schemaImplementationNotes(manifest),
  );
  await writeFile(path.join(OUT_DIR, "REVIEW_INDEX.md"), reviewMarkdown(manifest, validations));
  await writeFile(path.join(OUT_DIR, "review-index.html"), reviewIndexHtml(manifest, validations));

  console.log(JSON.stringify({ outputDir: OUT_DIR, pages: manifest.pages.length, validations }, null, 2));
}

function schemaImplementationNotes(manifest) {
  return `# Schema Implementation Notes

Generated: ${manifest.generatedAt}

These solution pages include JSON-LD @graph blocks with:

- Organization, with iBOLT specialty categories such as phone mounts, tablet mounts, ELD mounts, forklift tablet mounts, AMPS mounting plates, restaurant tablet mounts, and live streaming camera mounts.
- WebPage and BreadcrumbList for each proposed /pages URL.
- FAQPage for every visible FAQ section.
- HowTo for every visible step-by-step selection/setup section.
- Product nodes with Offer data only for products fetched from current Shopify product JSON or backed by the local product catalog.

## Blog Article Schema

Existing Shopify blog posts should use Article or BlogPosting schema in the article template or the app renderer. Use the blog title, canonical article URL, published date, modified date, author/publisher, and the hero image when available. Do not add fake ratings or reviews.

## Product and Offer Schema Validation

Product page Product/Offer schema should be validated in the Shopify theme, not duplicated inside these solution pages. Validate that every product page exposes:

- Product name, image, brand, SKU when available, and canonical URL.
- Offer price, priceCurrency USD, availability, and itemCondition.
- AggregateRating or Review only when real review data exists.

## Shopify Placement

These files are review-only. If approved, create unpublished Shopify Pages using the payloads in payloads/*.shopify-page-payload.json, then publish after visual review. If Shopify strips script tags from page body content, move the schema block into a page template/snippet and render by page handle.
`;
}

function reviewMarkdown(manifest, validations) {
  return `# AEO Solution Pages Review

Generated: ${manifest.generatedAt}

Mode: review-only. Nothing was published to Shopify.

## Pages

${manifest.pages
  .map(
    (page) => `- [${page.title}](${page.preview})\n  - Proposed URL: ${page.proposedUrl}\n  - Shopify body: ${page.shopifyBody}\n  - Schema: ${page.schema}\n  - Keywords: ${page.targetKeywords.join(", ")}\n  - Products: ${page.products.length}\n  - B-roll: ${
      page.broll ? page.broll.reason : "Product photos only"
    }`,
  )
  .join("\n")}

## Validation Summary

${validations
  .map(
    (item) =>
      `- ${item.pass ? "PASS" : "CHECK"} ${item.slug}: ${item.wordCount} words, ${item.productLinks} product links, ${item.faqCount} FAQs, missing keywords: ${
        item.missingKeywords.length ? item.missingKeywords.join(", ") : "none"
      }, missing schema: ${item.missingSchemaTypes.length ? item.missingSchemaTypes.join(", ") : "none"}`,
  )
  .join("\n")}
`;
}

function reviewIndexHtml(manifest, validations) {
  const rows = manifest.pages
    .map((page) => {
      const validation = validations.find((item) => item.slug === page.slug);
      return `<tr>
  <td><a href="${page.preview}">${escapeHtml(page.title)}</a></td>
  <td>${escapeHtml(page.targetKeywords.join(", "))}</td>
  <td>${validation?.wordCount || 0}</td>
  <td>${validation?.pass ? "PASS" : "CHECK"}</td>
  <td><a href="${page.shopifyBody}">Shopify HTML</a> | <a href="${page.schema}">Schema</a></td>
</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AEO Solution Pages Review</title>
  <style>
    body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 32px 20px; background: #f7f8fa; color: #1f2328; }
    main { max-width: 1080px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 28px; box-shadow: 0 1px 12px rgba(0,0,0,0.08); }
    h1 { margin-top: 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { text-align: left; border-bottom: 1px solid #e4e4e4; padding: 12px 10px; vertical-align: top; }
    th { background: #f0f2f4; }
    a { color: #b6341f; font-weight: 700; text-decoration: none; }
    .note { padding: 12px 14px; border: 1px solid #d6d6d6; border-radius: 8px; background: #fafafa; }
  </style>
</head>
<body>
<main>
  <h1>AEO Solution Pages Review</h1>
  <p class="note"><strong>Review-only.</strong> Nothing was published to Shopify. These are dedicated solution-page drafts with FAQ, WebPage, Product/Offer, HowTo, Breadcrumb, and Organization schema files.</p>
  <table>
    <thead>
      <tr><th>Page</th><th>Target Weak Keywords</th><th>Words</th><th>Validation</th><th>Artifacts</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</main>
</body>
</html>`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
