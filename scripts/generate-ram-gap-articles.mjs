#!/usr/bin/env node

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";
import Papa from "papaparse";

const MODEL = process.env.TOP_TEN_WRITER_MODEL || "claude-fable-5";
const OUT = path.resolve("content-output/ram-gap-article-batch-2026-08-08");
const DRAFTS = path.join(OUT, "drafts");
const PREVIEWS = path.join(OUT, "previews");
const INVENTORY = path.resolve("content-output/shopify-blog-performance-check-2026-08-05/shopify-blog-article-inventory.csv");
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const requestedSlug = process.argv.find((arg) => arg.startsWith("--article="))?.slice("--article=".length);
if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required.");

const topics = [
  ["motorcycle-iphone-vibration-protection", "How to Protect an iPhone From Motorcycle Vibration", "motorcycle iPhone vibration phone mount", ["motorcycle", "moto-vise", "handlebar", "mirror"]],
  ["motorcycle-phone-mount-base-guide", "Motorcycle Phone Mount Bases: Which One Fits?", "motorcycle phone mount base", ["motorcycle", "handlebar", "mirror", "bolt adapter"]],
  ["rv-motorhome-phone-tablet-mounts", "Phone and Tablet Mounts for RVs and Motorhomes", "RV phone and tablet mounts", ["suction cup", "cup holder", "tablet", "phone"]],
  ["fire-truck-ems-tablet-mounts", "Tablet Mounts for Fire Trucks and EMS Vehicles", "fire truck tablet mount", ["locking tablet", "seat rail", "drill base", "vehicle"]],
  ["police-mdt-mounting-guide", "Police MDT Mounting Guide for Patrol Vehicles", "police MDT mount", ["locking tablet", "seat rail", "drill base", "vehicle"]],
  ["waste-fleet-tablet-mounts", "Tablet Mounts for Garbage Trucks and Waste Fleets", "garbage truck tablet mount", ["locking tablet", "drill base", "seat rail", "vehicle"]],
  ["heavy-equipment-tablet-mounts", "Heavy Equipment Tablet Mounts by Cab Attachment", "heavy equipment tablet mount", ["tractor", "pillar", "magnetic tablet", "drill base"]],
  ["uber-lyft-phone-mounts", "Best Phone Mounts for Uber and Lyft Drivers", "phone mounts for Uber and Lyft", ["phone cup holder", "phone suction", "phone seat rail", "magnetic vehicle"]],
  ["zebra-warehouse-workstation-mounting", "Zebra Warehouse Workstation Mounting Guide", "Zebra warehouse workstation mount", ["zebra", "barcode scanner", "tablet forklift", "vesa"]],
  ["ford-maverick-device-mounting", "Ford Maverick Phone and Tablet Mounting Guide", "Ford Maverick phone mount", ["vehicle", "phone suction", "tablet suction", "cup holder"]],
  ["windshield-phone-mount-laws-guide", "Windshield Phone Mount Laws: What Drivers Must Check", "windshield phone mount laws", ["phone suction", "cup holder", "seat rail", "drill base"]],
  ["samsung-dex-mobile-workstation", "How to Build a Samsung DeX Mobile Workstation", "Samsung DeX workstation mount", ["tablet stand", "tablet clamp", "tablet mount", "keyboard"]],
  ["ice-fishing-electronics-mounts", "Ice Fishing Mounts for Fish Finders and Phones", "ice fishing electronics mount", ["fish finder", "phone clamp", "magnetic", "camera"]],
  ["tablet-infotainment-older-cars", "Tablet Infotainment Mounts for Older Cars", "tablet infotainment mount", ["tablet suction", "tablet cup holder", "seat gap", "headrest"]],
  ["home-tablet-mount-ideas", "Home Tablet Mount Ideas for Kitchens and Beds", "home tablet mount ideas", ["bedside", "tablet stand", "tablet clamp", "kitchen"]],
  ["toyota-rav4-device-mounting", "Toyota RAV4 Phone and Tablet Mounting Guide", "Toyota RAV4 phone mount", ["vehicle", "phone suction", "tablet suction", "cup holder"]],
  ["mazda-cx5-device-mounting", "Mazda CX-5 Phone and Tablet Mounting Guide", "Mazda CX-5 phone mount", ["vehicle", "phone suction", "tablet suction", "cup holder"]],
  ["satellite-communicator-mount-guide", "Satellite Communicator Mounting Guide", "satellite communicator mount", ["garmin", "17mm", "handlebar", "clamp"]],
  ["storm-chasing-vehicle-tech-mounts", "Storm Chasing Vehicle Tech Mounting Guide", "storm chasing vehicle mounts", ["tablet suction", "phone suction", "camera suction", "cup holder"]],
  ["paddleboard-phone-mounting-guide", "Paddleboard Phone Mounting Guide", "paddleboard phone mount", ["phone handlebar", "clamp", "rail", "action camera"]],
].map(([slug, title, keyword, terms]) => ({ slug, title, keyword, terms }));
const runTopics = requestedSlug ? topics.filter((topic) => topic.slug === requestedSlug) : topics;
if (!runTopics.length) throw new Error(`Unknown article slug: ${requestedSlug}`);

const banned = ["game-changer", "revolutionize", "seamless", "cutting-edge", "next-level", "groundbreaking", "state-of-the-art", "paradigm shift", "synergy", "leverage", "empower", "robust", "holistic", "streamline", "best-in-class", "world-class", "look no further", "budget option", "affordable alternative", "cheaper than ram", "cost-effective alternative"];

function text(value = "") { return String(value).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim(); }
function words(value = "") { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((x) => x.length > 2); }
function similarity(a, b) { const A=new Set(words(a)), B=new Set(words(b)); const hit=[...A].filter(x=>B.has(x)).length; return hit/Math.max(1,Math.min(A.size,B.size)); }

async function getProducts() {
  const all=[];
  for (let page=1; page<=5; page++) {
    const response=await fetch(`https://iboltmounts.com/products.json?limit=250&page=${page}`);
    if (!response.ok) throw new Error(`Catalog page ${page}: ${response.status}`);
    const batch=(await response.json()).products || [];
    all.push(...batch); if (batch.length < 250) break;
  }
  return all;
}

function selectProducts(topic, products) {
  const scored=products.map((product) => {
    const hay=text(`${product.title} ${product.tags} ${product.product_type} ${product.body_html}`).toLowerCase();
    const score=topic.terms.reduce((sum, term) => sum + (hay.includes(term.toLowerCase()) ? 4 : words(term).reduce((s,w)=>s+(hay.includes(w)?1:0),0)),0);
    return { product, score };
  }).filter((x)=>x.score>0).sort((a,b)=>b.score-a.score);
  const chosen=[]; const seen=new Set();
  for(const item of scored){ if(seen.has(item.product.handle)) continue; seen.add(item.product.handle); chosen.push(item.product); if(chosen.length===5) break; }
  if(chosen.length<4) throw new Error(`${topic.slug}: only ${chosen.length} relevant products`);
  return chosen.map((product)=>({ title:product.title, handle:product.handle, url:`https://iboltmounts.com/products/${product.handle}`, price:product.variants?.[0]?.price||"", image:product.images?.[0]?.src||"", description:text(product.body_html).slice(0,420) }));
}

function evidence(products) { return products.map((p,i)=>`${i+1}. ${p.title}\nPrice: $${p.price}\nURL: ${p.url}\nImage: ${p.image||"none"}\nOfficial copy: ${p.description}`).join("\n\n"); }

const system=`You are the iBOLT Mounts senior commerce editor. Return only Shopify-ready Markdown. Use conversational expertise, education first and sales second. Write iBOLT exactly. Position iBOLT as a commercial-duty specialist and smart total-value choice, never as cheap or universally best.

Rules:
- Start with Meta Title:, Meta Description:, Slug:, then one H1.
- Meta title under 60 characters, meta description under 155.
- 850 to 1250 words. Use 3 to 5 H2 sections plus an FAQ with 4 questions.
- Use only supplied product evidence. Link 4 or 5 relevant products with exact URLs and include exactly 2 supplied product images in linked HTML blocks.
- State fit limitations clearly. Universal mounting options are not confirmed vehicle-specific fitment.
- Never invent load ratings, vibration testing, certifications, legal conclusions, device compatibility, materials, warranties or hands-on tests.
- For legal content, explain that rules vary and readers must verify current state law. Do not give state-by-state conclusions without supplied primary law.
- For motorcycle vibration, distinguish mount retention from camera stabilization and do not promise damage prevention.
- For water use, do not describe a product as waterproof unless the supplied copy does.
- No em dash or en dash. Avoid ${banned.join(", ")}.
- End with an invitational CTA.`;

function prompt(topic, products, correction="") { return `Write this original iBOLT draft.\nTitle direction: ${topic.title}\nPrimary keyword: ${topic.keyword}\nAngle: answer the operational selection question better than a generic competitor roundup.\n\nVerified live products:\n${evidence(products)}\n\nDo not mention that this topic came from RAM Mounts. Do not copy competitor wording or structure.${correction}`; }

function clean(value) { return String(value).replace(/^```(?:markdown)?\s*/i,"").replace(/\s*```$/i,"").replace(/[—–]/g,", ").trim(); }
function mechanical(markdown, topic, products) {
  const issues=[]; const lower=markdown.toLowerCase(); const wc=words(markdown).length;
  if(wc<800||wc>1350) issues.push(`word count ${wc}`);
  if(/[—–]/.test(markdown)) issues.push("dash character");
  for(const phrase of banned) if(lower.includes(phrase)) issues.push(`banned phrase ${phrase}`);
  if(!/^Meta Title:/mi.test(markdown)||!/^Meta Description:/mi.test(markdown)||!/^Slug:/mi.test(markdown)||!/^#\s+/m.test(markdown)) issues.push("missing metadata or H1");
  const mt=markdown.match(/^Meta Title:\s*(.+)$/mi)?.[1]?.trim()||""; const md=markdown.match(/^Meta Description:\s*(.+)$/mi)?.[1]?.trim()||"";
  if(mt.length>=60) issues.push(`meta title ${mt.length}`); if(md.length>=155) issues.push(`meta description ${md.length}`);
  const links=products.filter((p)=>markdown.includes(p.url)).length; if(links<4) issues.push(`only ${links} verified product links`);
  if((markdown.match(/<img\s/gi)||[]).length!==2) issues.push("image count not 2");
  if((markdown.match(/^\*\*.+\?\*\*/gm)||[]).length<4) issues.push("fewer than 4 FAQ questions");
  return issues;
}

async function call(systemText,userText,maxTokens=8192) {
  const result=await anthropic.messages.create({ model:MODEL, max_tokens:maxTokens, output_config:{effort:"low"}, system:systemText, messages:[{role:"user",content:userText}] });
  return result.content.filter((x)=>x.type==="text").map((x)=>x.text).join("\n");
}

async function verify(topic, markdown, products) {
  const raw=await call("You are a strict iBOLT blog verifier. Return JSON only with overallScore (0-100), brandConsistency, seoOptimization, naturalLanguage, factualAccuracy, issues array, suggestions array. Penalize unsupported claims, misleading vehicle fit, legal conclusions, copied competitor framing, repetition, weak product evidence, and unnatural prose. Pass quality at 70.", `Topic: ${topic.title}\nVerified products: ${JSON.stringify(products)}\nDraft:\n${markdown}`, 2500);
  try { return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]||raw); } catch { return {overallScore:0,issues:["Verifier returned invalid JSON"],suggestions:[]}; }
}

async function generateOne(topic, products) {
  let markdown=""; let quality=null; let issues=[];
  for(let attempt=1; attempt<=3; attempt++) {
    const correction=attempt===1?"":`\n\nRewrite to fix: ${[...issues,...(quality?.issues||[])].join("; ")}. Keep all verified URLs and exactly two images.`;
    markdown=clean(await call(system,prompt(topic,products,correction)));
    issues=mechanical(markdown,topic,products);
    quality=issues.length?{overallScore:0,issues,suggestions:[]}:await verify(topic,markdown,products);
    if(!issues.length && Number(quality.overallScore)>=70) return {markdown,quality,attempt};
  }
  throw new Error(`${topic.slug}: failed verification: ${[...issues,...(quality?.issues||[])].join("; ")}`);
}

await mkdir(DRAFTS,{recursive:true}); await mkdir(PREVIEWS,{recursive:true});
const products=await getProducts();
const inventory=Papa.parse(await readFile(INVENTORY,"utf8"),{header:true,skipEmptyLines:true}).data;
const results=[]; let cursor=0; const concurrency=3;
async function worker(){ while(cursor<runTopics.length){ const topic=runTopics[cursor++]; const closest=inventory.map((x)=>({title:x.title,url:x.live_url,score:similarity(topic.title,x.title)})).sort((a,b)=>b.score-a.score)[0]; if(closest?.score>=0.8) { results.push({slug:topic.slug,success:false,error:`duplicate risk: ${closest.title}`,closest}); continue; } const selected=selectProducts(topic,products); try { console.log(`[generate] ${topic.slug}`); const generated=await generateOne(topic,selected); const file=path.join(DRAFTS,`${topic.slug}.md`); await writeFile(file,`${generated.markdown}\n`); const html=marked.parse(generated.markdown.replace(/^Meta Title:.*\nMeta Description:.*\nSlug:.*\n?/m,"")); await writeFile(path.join(PREVIEWS,`${topic.slug}.html`),`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:900px;margin:40px auto;padding:0 24px;line-height:1.6;color:#222}img{max-width:560px;width:100%;height:auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:9px}</style>${html}`); results.push({slug:topic.slug,title:topic.title,success:true,attempt:generated.attempt,score:generated.quality.overallScore,quality:generated.quality,closest,products:selected.map((p)=>p.handle),file:path.relative(process.cwd(),file)}); } catch(error){ results.push({slug:topic.slug,title:topic.title,success:false,error:String(error),closest,products:selected.map((p)=>p.handle)}); } }}
await Promise.all(Array.from({length:concurrency},worker));
let finalResults=results;
if(requestedSlug){ try { const old=JSON.parse(await readFile(path.join(OUT,"manifest.json"),"utf8")); finalResults=[...old.results.filter((r)=>r.slug!==requestedSlug&&r.slug!=="ford-f150-work-truck-mounting"),...results]; } catch {} }
finalResults.sort((a,b)=>topics.findIndex(t=>t.slug===a.slug)-topics.findIndex(t=>t.slug===b.slug));
await writeFile(path.join(OUT,"manifest.json"),`${JSON.stringify({generatedAt:new Date().toISOString(),mode:"draft-only",published:false,model:MODEL,effort:"low",results:finalResults},null,2)}\n`);
const cards=finalResults.map((r)=>r.success?`<li><a href="./previews/${r.slug}.html">${r.title}</a> <small>Verifier ${r.score}/100</small></li>`:`<li>${r.title||r.slug}: FAILED, ${r.error}</li>`).join("\n");
await writeFile(path.join(OUT,"index.html"),`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:900px;margin:40px auto;padding:0 24px;line-height:1.6}li{margin:12px 0}small{color:#666}</style><h1>iBOLT RAM Gap Drafts</h1><p>Review-only. Nothing in this batch has been published.</p><ol>${cards}</ol>`);
console.log(JSON.stringify({output:OUT,success:finalResults.filter(r=>r.success).length,failed:finalResults.filter(r=>!r.success).length},null,2));
if(finalResults.some(r=>!r.success)) process.exitCode=1;
