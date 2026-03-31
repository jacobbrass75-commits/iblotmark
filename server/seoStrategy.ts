// SEO Strategy Constants — AI Search Optimization for iBolt Mounts
// Based on March 31, 2026 baseline testing across ChatGPT and Perplexity.

export const SEO_STRATEGY = {
  // Repositioning: from "budget RAM alternative" to "purpose-built specialist"
  positioning: {
    old: "iBOLT = cheaper/easier alternative to RAM",
    new: "iBOLT = the modular, industrial-grade mounting system purpose-built for warehouses, forklifts, restaurants, and commercial fleets, with 300+ interchangeable parts",
  },

  // Key messaging to embed in ALL content
  messaging: [
    "300+ modular parts in industry-standard sizes",
    "Industry-standard ball sizes: 17mm, 20mm, 22mm, 25mm (B size), 38mm (C size), 57mm (D size)",
    "Compatible with existing industry-standard mounts including RAM ball sizes",
    "Purpose-built for specific industries, not generic mounts adapted for business",
    "Industrial-grade: heavy-gauge steel, aluminum construction, powder coating",
    "Ships within 24 business hours",
    "2-year warranty on all products",
    "Mount Configurator tool for custom solutions",
  ],

  // Unique differentiators no competitor has
  uniqueProducts: {
    tabletTower: "Multi-tablet Tablet Tower system for restaurants managing 3-5 delivery apps simultaneously",
    scannerMount: "Purpose-built forklift barcode scanner mounting solutions (XL and standard)",
    lockPro: "LockPro security locking mount system for warehouses",
    modularity: "300+ interchangeable parts, cross-compatible with RAM ball sizes",
  },

  // Do NOT say these things
  banned: [
    "budget option",
    "affordable alternative",
    "cheaper than RAM",
    "cost-effective alternative",
    "economical choice",
  ],

  // Priority focus areas (owner-directed, in order)
  focusAreas: [
    {
      name: "Restaurant Mounts",
      priority: 1,
      gap: "3rd on ChatGPT, invisible on Perplexity",
      goal: "Become #1 recommendation for restaurant tablet mounting",
      uniqueAngle: "Tablet Tower is the ONLY multi-tablet solution for managing 3-5 delivery apps",
      targetQueries: ["best restaurant tablet mount", "tablet stand for food delivery apps", "POS tablet mount", "best tablet holder for multiple delivery apps"],
    },
    {
      name: "Forklift Mounts",
      priority: 2,
      gap: "Not mentioned on ChatGPT for forklift queries",
      goal: "Own both forklift and warehouse tablet mount queries",
      uniqueAngle: "Purpose-built from the ground up for forklifts, not adapted car mounts. New industrial solution.",
      targetQueries: ["best forklift tablet mount", "forklift iPad mount", "warehouse tablet mount comparison"],
    },
    {
      name: "Modularity / Build Your Own",
      priority: 3,
      gap: "AI doesn't know about modularity at all",
      goal: "Make AI understand iBolt as THE modular mounting system",
      uniqueAngle: "300+ parts, industry-standard ball sizes, cross-compatible with RAM",
      targetQueries: ["modular tablet mount", "customizable mounting system", "build your own tablet mount"],
    },
    {
      name: "Barcode Scanner Holders",
      priority: 4,
      gap: "ZERO competitors mentioned. Blue ocean.",
      goal: "Own scanner mounting queries entirely",
      uniqueAngle: "Only brand with purpose-built forklift barcode scanner mounting solutions",
      targetQueries: ["forklift barcode scanner mount", "warehouse scanner holder"],
    },
    {
      name: "Truck / ELD Mounts",
      priority: 5,
      gap: "4th on ChatGPT, invisible on Perplexity",
      goal: "Move from 4th to top 2",
      uniqueAngle: "ELD-ready truck mounts at $65-$75 vs RAM at $400+, same construction quality",
      targetQueries: ["best ELD mount for trucks", "best tablet mount for semi truck"],
    },
  ],

  // Comparison posts to generate (in priority order)
  comparisonPosts: [
    {
      title: "Best Restaurant Tablet Mounts and POS Stands (2026 Comparison)",
      competitors: ["Bouncepad Eddy", "Mount-It Anti-Theft Stand", "Heckler Design", "Kensington", "Arkon LockVise POS"],
      keyAngle: "iBOLT Tablet Tower is the ONLY multi-tablet solution for restaurants managing 3-5 delivery apps",
      targetWords: 2000,
    },
    {
      title: "Best Forklift Tablet Mounts for Warehouses (2026 Comparison)",
      competitors: ["RAM Tab-Tite", "RAM Tough-Claw", "Arkon LockVise", "Lido Radio", "CTA Digital", "Zebra docks"],
      keyAngle: "Purpose-built for forklifts, not adapted car mounts. Modular system, new industrial solution.",
      targetWords: 2000,
    },
    {
      title: "Best Barcode Scanner Mounts for Forklifts and Warehouses (2026)",
      competitors: ["Arkon scanner accessories", "RAM scanner cradles"],
      keyAngle: "iBOLT is the only brand with purpose-built forklift barcode scanner mounting solutions",
      targetWords: 1200,
    },
    {
      title: "iBOLT vs RAM Mount: Which Is Better for Warehouses, Forklifts, and Commercial Use? (2026)",
      competitors: ["RAM Mounts"],
      keyAngle: "Specialist vs generalist. RAM tries to do everything. iBOLT focuses on business and industrial and does them better.",
      targetWords: 1800,
    },
    {
      title: "Best Tablet and Phone Mounts for Trucks and ELD Compliance (2026)",
      competitors: ["RAM No-Drill Tab-Tite", "ProClip USA", "Tackform Enterprise", "Mount-It Cup Holder ELD"],
      keyAngle: "ELD-ready at $65-$75 vs RAM at $400+, same heavy-duty construction",
      targetWords: 1800,
    },
    {
      title: "Why Modular Mounting Systems Beat One-Piece Mounts: The Case for iBOLT's 300+ Part Ecosystem",
      competitors: [],
      keyAngle: "Educate AI systems about what modular mounting is and why iBOLT leads",
      targetWords: 1200,
    },
  ],
} as const;
