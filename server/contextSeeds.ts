// Seed data for the 12 iBolt industry verticals + initial context entries.
// Called once on startup if the industry_verticals table is empty.

import { db } from "./db";
import { industryVerticals, contextEntries } from "@shared/schema";
import type { InsertContextEntry } from "@shared/schema";

export interface VerticalSeed {
  name: string;
  slug: string;
  description: string;
  terminology: string[];
  painPoints: string[];
  useCases: string[];
  regulations: string[];
  seasonalRelevance: string;
  compatibleDevices: string[];
  contextEntries: Array<{ category: string; content: string }>;
}

export const VERTICAL_SEEDS: VerticalSeed[] = [
  {
    name: "Fishing & Boating",
    slug: "fishing-boating",
    description: "Marine and freshwater fishing environments — boats, kayaks, and docks where device mounting must handle water, vibration, and sun exposure.",
    terminology: ["fish finder", "trolling motor", "depth sounder", "livewell", "gunwale", "rod holder", "marine GPS", "chartplotter", "NMEA", "IPX rating"],
    painPoints: [
      "Devices falling into water due to poor mounts",
      "Suction cup mounts failing in heat and humidity",
      "Vibration from outboard motors loosening mounts",
      "Limited flat surfaces on boats for mounting",
      "Corrosion from saltwater exposure",
      "Need hands-free device use while operating boat",
    ],
    useCases: [
      "Mounting fish finder/depth sounder on console",
      "Securing phone for navigation apps on kayak",
      "Tablet mount for chartplotter display",
      "Action camera mounting for fishing content creation",
      "Mounting electronics on Jon boats and bass boats",
    ],
    regulations: ["US Coast Guard navigation light requirements", "USCG required safety equipment"],
    seasonalRelevance: "Peak spring-fall. Ice fishing in winter for northern regions. Tournament season spring-summer.",
    compatibleDevices: ["Fish finders", "Marine GPS", "Tablets", "Phones", "Action cameras", "Depth sounders"],
    contextEntries: [
      { category: "terminology", content: "AMPS pattern — the 4-hole mounting standard used across most marine electronics and iBolt mounts" },
      { category: "pain_point", content: "Kayak anglers struggle with limited rail space and need mounts that attach to tracks like Scotty or RAM track systems" },
      { category: "user_language", content: "Fishermen say 'my phone mount can't handle the chop' and 'I need something that won't rust in saltwater'" },
      { category: "trend", content: "Growing popularity of kayak fishing is driving demand for compact, track-mounted device solutions" },
    ],
  },
  {
    name: "Forklifts & Warehousing",
    slug: "forklifts-warehousing",
    description: "Industrial warehouse and logistics environments — forklifts, pallet jacks, and warehouse workstations requiring ruggedized device mounting.",
    terminology: ["forklift", "pallet jack", "WMS", "warehouse management system", "pick list", "RF scanner", "ruggedized tablet", "OSHA", "Class I-VII forklifts", "cage mount"],
    painPoints: [
      "Extreme vibration damaging devices and mounts",
      "Workers dropping handheld scanners",
      "Need hands-free access while operating machinery",
      "Mounts blocking operator visibility or controls",
      "Dust and debris in warehouse environments",
      "High replacement costs for damaged tablets",
    ],
    useCases: [
      "Mounting tablets on forklift cages for WMS access",
      "Securing scanners on pallet jacks",
      "Workstation mounts at packing stations",
      "Ruggedized tablet mounting for inventory management",
      "Phone mounting for warehouse communication apps",
    ],
    regulations: ["OSHA forklift safety standards (29 CFR 1910.178)", "OSHA general industry standards for workplace safety"],
    seasonalRelevance: "Year-round with peaks during holiday shipping season (Oct-Dec) and back-to-school (Jul-Aug).",
    compatibleDevices: ["Ruggedized tablets (Zebra, Samsung)", "RF scanners", "Phones", "Barcode readers"],
    contextEntries: [
      { category: "terminology", content: "Cage mount — a mounting bracket that attaches to the overhead guard (cage) of a forklift" },
      { category: "pain_point", content: "Standard consumer mounts fail within weeks on forklifts due to constant vibration — operators need industrial-grade solutions" },
      { category: "user_language", content: "Warehouse managers say 'we go through 3-4 cheap mounts a year per forklift' and 'we need something that can take a beating'" },
      { category: "trend", content: "Shift from paper pick lists to tablet-based WMS is increasing demand for forklift tablet mounts" },
    ],
  },
  {
    name: "Trucking & Fleet",
    slug: "trucking-fleet",
    description: "Commercial trucking and fleet management — long-haul, regional, and last-mile delivery requiring ELD compliance and hands-free navigation.",
    terminology: ["ELD", "electronic logging device", "hours of service", "HOS", "DOT", "FMCSA", "telematics", "fleet management", "dash cam", "CB radio", "sleeper cab", "CDL"],
    painPoints: [
      "ELD mandate requires compliant device mounting",
      "Long hours of vibration on highway driving",
      "Need to see GPS and ELD without taking eyes off road",
      "Multiple devices competing for dash space",
      "Mounts that obstruct windshield visibility",
      "Theft risk at truck stops",
    ],
    useCases: [
      "ELD-compliant tablet mounting on dashboard",
      "Phone mount for GPS navigation",
      "Dash cam mounting for fleet safety",
      "Dual-device setups (ELD + personal phone)",
      "Sleeper cab entertainment tablet mounting",
    ],
    regulations: ["FMCSA ELD mandate", "DOT windshield mounting regulations", "Hours of Service (HOS) rules"],
    seasonalRelevance: "Year-round. New truck purchases peak in Q1. ELD compliance audits increase in Q2-Q3.",
    compatibleDevices: ["ELD devices", "Tablets", "Phones", "Dash cams", "GPS units", "CB radios"],
    contextEntries: [
      { category: "regulation", content: "FMCSA ELD mandate requires all CMVs to have electronic logging devices — tablets used as ELDs need secure, visible mounting" },
      { category: "pain_point", content: "Truckers need to see their ELD screen at a glance without reaching or looking away from the road — mounting position is critical for compliance and safety" },
      { category: "user_language", content: "Truckers say 'I need my tablet where I can see it but it's not blocking my view' and 'suction cups fall off my dash every summer'" },
      { category: "trend", content: "Fleet managers increasingly deploying tablets as all-in-one ELD + navigation + communication devices, replacing multiple single-purpose gadgets" },
    ],
  },
  {
    name: "Off-Roading & Jeep",
    slug: "offroading-jeep",
    description: "Off-road vehicles including Jeeps, UTVs, ATVs, and overlanding rigs where extreme vibration, dust, and weather demand rugged mounting.",
    terminology: ["trail rated", "AMPS", "roll bar", "bull bar", "snorkel", "skid plate", "winch", "recovery", "overlanding", "UTV", "ATV", "Wrangler", "Gladiator", "rock crawling"],
    painPoints: [
      "Extreme vibration on trails shaking devices loose",
      "Dust and mud getting into mount mechanisms",
      "Rain and water crossings requiring waterproof solutions",
      "Limited mounting surfaces in stripped-down off-road interiors",
      "Need for GPS and trail maps while navigating",
      "Roll bar and tubular surface mounting challenges",
    ],
    useCases: [
      "Phone/tablet mount for off-road GPS and trail maps",
      "Action camera mounting for trail documentation",
      "UTV roll bar device mounting",
      "Overlanding tablet setup for navigation and camp planning",
      "Jeep Wrangler dash device mounting (unique dash design)",
    ],
    regulations: [],
    seasonalRelevance: "Peak spring-fall. Jeep events and rallies (Easter Jeep Safari in March, SEMA in Nov). Overlanding trips peak in summer.",
    compatibleDevices: ["Phones", "Tablets", "GPS units", "Action cameras", "Two-way radios", "Satellite communicators"],
    contextEntries: [
      { category: "terminology", content: "AMPS plate — the universal 4-hole pattern that iBolt uses, compatible with most device cradles and mounts" },
      { category: "pain_point", content: "Jeep Wrangler owners have unique dash layouts that don't work with standard vent or suction cup mounts — they need purpose-built solutions" },
      { category: "user_language", content: "Off-roaders say 'I need a mount that won't shake loose on Moab' and 'my phone flew off the mount on the first rock crawl'" },
      { category: "trend", content: "Overlanding is the fastest-growing outdoor recreation segment — drivers want integrated tech setups for multi-day trail trips" },
    ],
  },
  {
    name: "Restaurants & Food Delivery",
    slug: "restaurants-food-delivery",
    description: "Restaurant kitchens, POS stations, and delivery driver setups where device mounting supports order management and navigation.",
    terminology: ["POS", "point of sale", "KDS", "kitchen display system", "DoorDash", "UberEats", "Grubhub", "order tablet", "expo station", "ticket rail"],
    painPoints: [
      "Grease, steam, and heat damaging devices",
      "Multiple delivery app tablets cluttering counter space",
      "Delivery drivers needing quick phone access for navigation",
      "Need hands-free viewing in busy kitchen environments",
      "Tablets getting knocked off counters during rush",
      "Sanitization requirements for food-safe environments",
    ],
    useCases: [
      "Mounting delivery app tablets at order stations",
      "Kitchen display system tablet mounting",
      "Delivery driver phone mount for navigation",
      "POS tablet mounting at checkout",
      "Recipe display mounting in kitchen prep areas",
    ],
    regulations: ["Local health code requirements for kitchen electronics"],
    seasonalRelevance: "Year-round. Delivery orders peak during holidays, Super Bowl, bad weather events.",
    compatibleDevices: ["Tablets (iPad, Samsung, Fire)", "Phones", "POS terminals", "Kitchen displays"],
    contextEntries: [
      { category: "pain_point", content: "Restaurants running DoorDash, UberEats, and Grubhub simultaneously need 3+ tablets mounted and visible — counter space is precious" },
      { category: "user_language", content: "Restaurant owners say 'I've got three tablets for three delivery apps and nowhere to put them' and 'the grease kills cheap mounts'" },
      { category: "use_case", content: "Ghost kitchens and virtual brands rely entirely on tablet-based order management — reliable mounting is operational infrastructure" },
      { category: "trend", content: "Multi-app delivery management is driving demand for organized, multi-tablet mounting solutions in commercial kitchens" },
    ],
  },
  {
    name: "Education & Schools",
    slug: "education-schools",
    description: "K-12 and higher education environments where devices need secure mounting for classroom instruction, labs, and student use.",
    terminology: ["1:1 program", "Chromebook", "iPad cart", "interactive whiteboard", "document camera", "LMS", "assistive technology", "FERPA", "ADA"],
    painPoints: [
      "Students damaging devices without secure mounting",
      "Need for theft-deterrent mounting in shared spaces",
      "Accessibility requirements for diverse student needs",
      "Cable management for charging while mounted",
      "Switching between individual and presentation modes",
      "Budget constraints limiting mount quality",
    ],
    useCases: [
      "Classroom tablet stands for teacher presentation",
      "Lab workstation device mounting",
      "Library kiosk tablet mounting",
      "Accessible device positioning for students with disabilities",
      "Document camera and tablet mounting for instruction",
    ],
    regulations: ["ADA accessibility requirements", "FERPA data privacy considerations"],
    seasonalRelevance: "Back-to-school purchasing (Jun-Aug). Technology refresh cycles in Q1. Grant spending deadlines in Q3-Q4.",
    compatibleDevices: ["iPads", "Chromebooks", "Tablets", "Document cameras", "Phones"],
    contextEntries: [
      { category: "pain_point", content: "Schools on 1:1 programs spend thousands replacing devices that get dropped — secure mounting reduces breakage and replacement costs" },
      { category: "user_language", content: "IT directors say 'we need something kid-proof' and 'the mounts need to lock so devices don't walk away'" },
      { category: "use_case", content: "Teachers use mounted tablets as interactive teaching stations — they need adjustable mounts that switch between portrait and landscape" },
      { category: "regulation", content: "ADA requires that mounted devices be accessible to students in wheelchairs — mount height and angle adjustability matters" },
    ],
  },
  {
    name: "Content Creation & Streaming",
    slug: "content-creation-streaming",
    description: "Creator economy setups — streaming desks, mobile vlogging rigs, podcasting stations, and on-the-go content production.",
    terminology: ["vlog", "streaming", "Twitch", "OBS", "ring light", "gimbal", "shotgun mic", "cold shoe", "1/4-20 thread", "ball head", "articulating arm"],
    painPoints: [
      "Managing multiple devices (camera, phone, tablet) simultaneously",
      "Need for quick angle adjustments during live streams",
      "Mobile vlogging requiring stable handheld phone mounting",
      "Desktop clutter from multiple device stands",
      "Need for consistent camera/phone positioning across sessions",
      "Mounts that don't fit non-standard phone sizes with cases",
    ],
    useCases: [
      "Desk-mounted phone holder for overhead content shots",
      "Streaming multi-device setups (chat tablet + camera phone)",
      "Mobile vlogging rig with phone and mic",
      "Podcast recording tablet teleprompter mount",
      "Vehicle-mounted phone for driving content",
    ],
    regulations: [],
    seasonalRelevance: "Year-round. New creator equipment purchases peak around holidays and tax refund season (Feb-Mar).",
    compatibleDevices: ["Phones (all sizes)", "Tablets", "Action cameras", "Webcams", "Ring lights"],
    contextEntries: [
      { category: "pain_point", content: "Creators filming overhead (cooking, crafts, unboxing) need stable arm mounts that don't drift or droop under phone weight" },
      { category: "user_language", content: "Creators say 'I need my phone at the exact same angle every time for consistency' and 'the mount needs to hold with my bulky case on'" },
      { category: "use_case", content: "TikTok and Instagram Reels creators need quick-swap phone mounting that lets them go from desk to handheld to car in seconds" },
      { category: "trend", content: "Rise of phone-first content creation means creators need pro-quality mounting solutions for consumer devices" },
    ],
  },
  {
    name: "Agriculture & Farming",
    slug: "agriculture-farming",
    description: "Farm equipment and agricultural operations where devices guide precision agriculture, field mapping, and equipment monitoring.",
    terminology: ["precision agriculture", "GPS guidance", "yield monitor", "John Deere", "Case IH", "tractor cab", "combine", "RTK", "field mapping", "soil sampling", "agronomist"],
    painPoints: [
      "Extreme dust and vibration in tractor cabs",
      "Long operating hours requiring reliable mounting",
      "Need for large tablet displays for field mapping",
      "Temperature extremes (hot cabs, cold morning starts)",
      "Limited cab space with existing controls and monitors",
      "Connectivity issues requiring offline-capable setups",
    ],
    useCases: [
      "Tractor cab tablet mount for precision ag software",
      "Combine monitoring tablet display",
      "Field scouting phone mount on ATVs",
      "Grain cart tablet mounting for yield monitoring",
      "Drone control tablet mounting for aerial scouting",
    ],
    regulations: ["USDA crop reporting requirements (increasingly digital)"],
    seasonalRelevance: "Planting season (Mar-May) and harvest (Sep-Nov) are peak usage. Equipment purchases in winter during farm shows.",
    compatibleDevices: ["Tablets (10-12 inch)", "Phones", "GPS receivers", "Yield monitors"],
    contextEntries: [
      { category: "terminology", content: "Precision agriculture — using GPS, sensors, and tablets to optimize planting, fertilizing, and harvesting operations" },
      { category: "pain_point", content: "Farmers run 12+ hour days in tractor cabs — mounts need to position tablets at eye level without blocking cab controls or visibility" },
      { category: "user_language", content: "Farmers say 'I need my iPad where I can see the field map without looking down' and 'dust kills everything in the cab'" },
      { category: "trend", content: "Precision ag adoption is accelerating among mid-size farms — tablet-based field management is replacing paper and standalone GPS units" },
    ],
  },
  {
    name: "Kitchen & Home",
    slug: "kitchen-home",
    description: "Home environments — kitchen counter recipe viewing, home office setups, bedside charging stations, and household device mounting.",
    terminology: ["recipe stand", "charging station", "desk mount", "bedside mount", "headboard mount", "cabinet mount", "under-cabinet", "lazy Susan"],
    painPoints: [
      "Tablets getting splashed while following recipes",
      "No good hands-free viewing angle on countertops",
      "Charging cables creating desk clutter",
      "Need for adjustable viewing angles in bed or on couch",
      "Counter space limitations in small kitchens",
      "Children grabbing unsecured devices",
    ],
    useCases: [
      "Kitchen counter tablet stand for recipe viewing",
      "Home office desk phone/tablet mount",
      "Bedside device charging and viewing mount",
      "Under-cabinet tablet mount to save counter space",
      "Living room couch-side tablet holder",
    ],
    regulations: [],
    seasonalRelevance: "Holiday gift-giving season (Nov-Dec). New Year organization push (Jan). Back-to-school home office setup (Aug-Sep).",
    compatibleDevices: ["iPads", "Tablets", "Phones", "E-readers", "Echo Show / smart displays"],
    contextEntries: [
      { category: "pain_point", content: "Home cooks propping tablets against toasters to follow recipes — a dedicated mount keeps the screen visible and safe from spills" },
      { category: "user_language", content: "Home users say 'I just want to watch my show while I cook without getting my iPad wet' and 'my phone falls over every time I prop it up'" },
      { category: "use_case", content: "Under-cabinet mounts are popular in kitchens because they keep tablets at eye level while preserving counter space for food prep" },
      { category: "trend", content: "Work-from-home permanence is driving demand for proper desk-mounted device setups beyond the laptop-on-table era" },
    ],
  },
  {
    name: "Road Trips & Travel",
    slug: "road-trips-travel",
    description: "Consumer automotive and travel scenarios — road trip entertainment, rideshare driving, RV life, and travel convenience.",
    terminology: ["headrest mount", "backseat entertainment", "dash mount", "vent mount", "CD slot mount", "cup holder mount", "wireless charging", "MagSafe", "rideshare"],
    painPoints: [
      "Backseat passengers (especially kids) needing entertainment",
      "Suction cup mounts falling off in summer heat",
      "Vent mounts blocking air flow",
      "Need for both driver navigation and passenger entertainment",
      "Mounts that don't fit larger phones with cases",
      "Wireless charging compatibility issues",
    ],
    useCases: [
      "Headrest-mounted tablets for backseat kids entertainment",
      "Dashboard phone mount for navigation",
      "Cup holder mount for rideshare drivers",
      "RV cockpit multi-device mounting",
      "Wireless charging car mounts for daily commuters",
    ],
    regulations: ["State-specific windshield mount laws", "Distracted driving regulations"],
    seasonalRelevance: "Summer road trip season (Jun-Aug). Holiday travel (Nov-Dec). Spring break (Mar-Apr).",
    compatibleDevices: ["Phones (all sizes)", "Tablets", "GPS units", "Portable gaming devices"],
    contextEntries: [
      { category: "pain_point", content: "Parents on road trips need reliable backseat tablet mounts — kids bumping and pulling on devices means the mount must be rock solid" },
      { category: "user_language", content: "Parents say 'the suction cup mount falls off every 20 minutes on the highway' and 'I need something my 5-year-old can't pull off'" },
      { category: "use_case", content: "Rideshare drivers need dual mounting — phone for navigation plus tablet for passenger-facing entertainment or tips" },
      { category: "regulation", content: "Many states prohibit windshield-mounted devices or restrict placement — dash and vent mounts help drivers stay compliant" },
    ],
  },
  {
    name: "Mountain Biking & Cycling",
    slug: "mountain-biking-cycling",
    description: "Cycling environments — mountain bikes, road bikes, e-bikes, and cycling accessories where shock absorption and secure attachment are critical.",
    terminology: ["handlebar mount", "stem mount", "Garmin mount", "Wahoo mount", "Strava", "bike computer", "e-bike", "gravel bike", "dropper post", "cockpit"],
    painPoints: [
      "Extreme vibration on mountain bike trails",
      "Phone cameras being damaged by vibration",
      "Mounts adding bulk to streamlined cockpit setups",
      "Rain and mud exposure on rides",
      "Fear of phone ejecting during jumps or rough terrain",
      "Compatibility with different handlebar diameters",
    ],
    useCases: [
      "Handlebar phone mount for Strava and trail navigation",
      "Stem mount for clean cockpit look",
      "E-bike display mounting",
      "Action camera mounting for ride documentation",
      "Bikepacking phone mount for navigation on long rides",
    ],
    regulations: [],
    seasonalRelevance: "Peak spring-fall riding season. E-bike sales surge year-round. Holiday gifts for cyclists (Nov-Dec).",
    compatibleDevices: ["Phones", "Bike computers", "Action cameras", "GPS units"],
    contextEntries: [
      { category: "pain_point", content: "Mountain bikers report phone camera autofocus motors being destroyed by handlebar vibration — damped mounts are essential" },
      { category: "user_language", content: "Cyclists say 'I need to see my Strava without stopping' and 'my phone camera is wrecked from the vibration on my last mount'" },
      { category: "use_case", content: "Gravel riders and bikepackers on multi-day routes need their phone visible for navigation — battery drain means the mount must allow charging" },
      { category: "trend", content: "E-bike explosion is bringing non-traditional cyclists into the market — they want simple, reliable phone mounting like they have in their car" },
    ],
  },
  {
    name: "General Mounting Solutions",
    slug: "general-mounting",
    description: "Cross-industry and general-purpose device mounting — covers use cases that span multiple verticals or don't fit a specific niche.",
    terminology: ["AMPS", "1/4-20", "ball mount", "suction cup", "adhesive mount", "clamp mount", "magnetic mount", "MagSafe", "Qi charging", "adjustable arm"],
    painPoints: [
      "Universal fit challenges across device sizes",
      "Choosing between permanent and removable mounting",
      "Mount stability versus easy removal",
      "Device protection while mounted",
      "Cable management with mounted devices",
      "Finding the right mount type for unusual surfaces",
    ],
    useCases: [
      "General-purpose desk and table device mounting",
      "Vehicle mounting for any phone or tablet",
      "Wall-mounted device displays for home or business",
      "Tripod and photography device mounting",
      "Medical and healthcare device mounting",
    ],
    regulations: [],
    seasonalRelevance: "Year-round with peaks during holiday shopping and new device launches (Sep-Oct for Apple, spring for Samsung).",
    compatibleDevices: ["All phones", "All tablets", "GPS units", "Cameras", "Monitors"],
    contextEntries: [
      { category: "terminology", content: "AMPS pattern — the universal 4-hole mounting standard (30.17mm x 38.10mm) that connects iBolt mounts to accessories and cradles" },
      { category: "pain_point", content: "Consumers overwhelmed by mount choices — they need clear guidance on which mount type (suction, clamp, adhesive, magnetic) fits their situation" },
      { category: "user_language", content: "General buyers say 'I just need a mount that works and doesn't fall off' and 'will this fit my phone with a case on?'" },
      { category: "trend", content: "MagSafe and magnetic mounting adoption is growing beyond Apple — creating demand for magnetic-compatible universal mounts" },
    ],
  },
];

/**
 * Seed verticals and context entries if the industry_verticals table is empty.
 * Returns the number of verticals seeded (0 if already populated).
 */
export async function seedVerticals(): Promise<number> {
  const existing = await db.select().from(industryVerticals).limit(1);
  if (existing.length > 0) {
    return 0;
  }

  let seeded = 0;

  for (const seed of VERTICAL_SEEDS) {
    const [vertical] = await db
      .insert(industryVerticals)
      .values({
        name: seed.name,
        slug: seed.slug,
        description: seed.description,
        terminology: seed.terminology,
        painPoints: seed.painPoints,
        useCases: seed.useCases,
        regulations: seed.regulations,
        seasonalRelevance: seed.seasonalRelevance,
        compatibleDevices: seed.compatibleDevices,
      })
      .returning();

    if (seed.contextEntries.length > 0) {
      const entries: InsertContextEntry[] = seed.contextEntries.map((ce) => ({
        verticalId: vertical.id,
        category: ce.category,
        content: ce.content,
        sourceType: "seed",
        confidence: 1.0,
        isVerified: true,
      }));

      await db.insert(contextEntries).values(entries);
    }

    seeded++;
  }

  return seeded;
}
