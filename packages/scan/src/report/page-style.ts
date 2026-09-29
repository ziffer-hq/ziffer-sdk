/**
 * The `--code` report's stylesheet (ACP-455 presentation, third design, 2026-09-28), ported from the
 * approved prototype (report-v3), which speaks the language of the ZIFFER site: full-width bands that
 * alternate paper and white with ONE orange band, headings in two tones, white cards on paper and
 * paper cards on white, pills for tags and buttons, code always in the dark card. Sections are told
 * apart by the band change, never by a rule or a number.
 *
 * Where the prototype is silent (the appendix, the legend, the footer, print) the rules below extend
 * it in the same language.
 *
 * COLOUR: orange marks only what the reader must act on, plus the one orange band and the buttons.
 * Everything else is ink, its two greys and paper. A word beside the colour always says what it means.
 */

import { fontFaces, MONO, SANS } from './fonts.js';

const TOKENS =
  ':root{--paper:#F3EDE2;--card:#FFFFFF;--white:#FFFFFF;--ink:#191919;--rule:#DFD6C6;--rule-soft:#EAE2D3;--ink-2:#6F675A;--ink-3:#98907F;' +
  '--muted:#6F675A;--faint:#98907F;--orange:#E75E0D;--orange-dark:#C74F06;--orange-tint:#FBE9DA;--orange-soft:#F7D9C0;--on-orange:#FFF6EC;--ink-card:#2E2A25;' +
  '--act:#E75E0D;--act-text:#C74F06;--act-tint:#FBE9DA;' +
  // The dark grounds (code, the steer band) and what is written on them: each pair meets WCAG AA (`contrast.test.ts`).
  '--dark:#191919;--on-dark:#F6F1E8;--on-dark-2:#E4DDCF;--on-dark-3:#B8B0A0;--dark-key:#FF9A57;--dark-com:#A9A191;--dark-bar:#C9C1B1;--dark-rule:#35312B;--copy:#FF7A2B;--copy-ok:#7BD389;' +
  `--r:18px;--r-lg:26px;--sh-s:0 1px 2px rgba(25,25,25,.05);--sh-m:0 1px 3px rgba(25,25,25,.05),0 12px 32px rgba(25,25,25,.07);--sans:${SANS};--mono:${MONO}}`;

const PAGE = `
*{box-sizing:border-box}html{background:var(--paper);-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:400 16px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
main{display:block}
.wrap{max-width:1156px;margin:0 auto;padding:0 24px}
code,.mono{font-family:var(--mono)}
code{font-size:.86em}
a{color:inherit;text-underline-offset:3px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
/* nav */
.mast{border-bottom:1px solid var(--rule-soft)}
.mast .wrap{display:flex;align-items:center;justify-content:space-between;gap:24px;height:64px}
.mast svg.logo{height:27px;width:auto;display:block;flex:0 0 auto}
.mast .meta{display:flex;align-items:center;gap:18px;font:400 12.5px/1 var(--mono);color:var(--ink-2);min-width:0}
.mast .meta span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mast .meta b{font-weight:400}
.cta,.pill{display:inline-flex;align-items:center;gap:8px;border-radius:99px;font:500 14.5px/1 var(--sans);padding:13px 20px;text-decoration:none;white-space:nowrap;background:var(--orange);color:var(--dark)}
.pill.quiet{background:var(--card);color:var(--ink);box-shadow:inset 0 0 0 1px var(--rule)}
/* bands */
.band{padding:72px 0}
.band.white{background:var(--card)}
.band.ink{background:var(--dark);color:var(--on-dark)}
.band.tight{padding:40px 0}
.eyebrow{font:400 12.5px/1.4 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--ink-2);display:flex;align-items:center;gap:10px;margin:0 0 16px}
.eyebrow:before{content:"";width:7px;height:7px;background:var(--orange);transform:rotate(45deg);flex:none}
.head{margin:0 0 32px}
.head.c{max-width:900px;margin-left:auto;margin-right:auto;text-align:center}
.head.c .eyebrow{justify-content:center}
h2{font:600 34px/1.3 var(--sans);margin:0;letter-spacing:0}
h2 span{color:var(--ink-3)}
.lead{margin:14px 0 0;font-size:17px;color:var(--ink-2)}
.lead b{color:var(--ink);font-weight:600}
.head .lead a.term{color:inherit}
/* hero */
.hero{padding:18px 0 0}
.hero .g{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:40px;align-items:center}
.hero .g.solo{grid-template-columns:1fr}
.hero .eyebrow{margin:0 0 12px}
h1{font:600 36px/1.22 var(--sans);margin:0;letter-spacing:0;overflow-wrap:anywhere}
h1.long{font-size:31px}
h1 em{font-style:normal;color:var(--orange);position:relative;z-index:0}
h1 em:after{content:"";position:absolute;left:-1%;right:-1%;bottom:8%;height:26%;background:var(--orange-soft);z-index:-1;border-radius:4px}
.lede{margin:10px 0 0;color:var(--ink-2);font-size:15.5px}
.lede b{color:var(--ink);font-weight:600}
/* the grade card */
.grade{background:var(--card);border-radius:var(--r);box-shadow:var(--sh-m);padding:16px 22px}
.grade .top{display:flex;justify-content:space-between;align-items:center;font:400 12px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-2)}
.grade .prov{letter-spacing:0;text-transform:none;background:var(--orange-tint);color:var(--orange-dark);border-radius:99px;padding:5px 9px}
.grade .v{font:600 40px/1 var(--sans);margin:0}
.grade .gr{display:grid;grid-template-columns:auto minmax(0,1fr);gap:16px;align-items:center;margin:12px 0 0}
.grade .v span{font-weight:400;color:var(--ink-3);font-size:28px;padding:0 8px}
.scale{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin:0;padding:0;list-style:none}
.scale li{font:500 12px/26px var(--mono);text-align:center;border-radius:6px;color:#fff;opacity:.28}
.scale li.on{opacity:1}
/* the grade within reach: outlined in its own colour, at full strength, never lit like today's */
.grade .scale li.reach{opacity:1;background:transparent;box-shadow:inset 0 0 0 2px currentColor}
.scale li.reach.g-a{color:#2E7D4F}.scale li.reach.g-b{color:#6B8828}.scale li.reach.g-c{color:#A87C0A}.scale li.reach.g-d{color:#C85E10}.scale li.reach.g-f{color:#C5281C}
.scale-l{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin:4px 0 0;padding:0;list-style:none;font:400 10.5px/1.2 var(--mono);color:var(--ink-2);text-align:center}
.grade p.why{margin:8px 0 0;font:400 11.5px/1.4 var(--mono);color:var(--orange-dark)}
.scale li.g-a{background:#2E7D4F}.scale li.g-b{background:#7A9A2E;color:var(--dark)}.scale li.g-c{background:#D4A017;color:var(--dark)}.scale li.g-d{background:#E0701A;color:var(--dark)}.scale li.g-f{background:#C5281C}
.grade .v em{font-style:normal}.grade .v em.g-a{color:#2E7D4F}.grade .v em.g-b{color:#6B8828}.grade .v em.g-c{color:#A87C0A}.grade .v em.g-d{color:#C85E10}.grade .v em.g-f{color:#C5281C}
.grade p{margin:10px 0 0;font-size:13px;line-height:1.4;color:var(--ink-2)}
.grade p b{color:var(--ink);font-weight:600}
/* the door, in its dotted panel */
.door{margin:14px 0 0;border:1px solid var(--rule-soft);border-radius:var(--r-lg);background:radial-gradient(circle at 1px 1px,var(--rule) 1px,transparent 0) 0 0/22px 22px,#FBF8F2;padding:6px}
.door svg{display:block;width:100%;height:auto}
.door text{font-family:var(--sans);fill:var(--ink)}
.door text.m,.door tspan.m{font-family:var(--mono)}
.door .f-muted{fill:var(--ink-2)}.door .f-faint{fill:var(--ink-3)}.door .f-act{fill:var(--orange)}.door .f-act-text{fill:var(--orange-dark)}
.door .f-none{fill:none}.door .f-soft{fill:var(--orange-soft)}.door .f-white{fill:#fff}.door .f-ink{fill:var(--ink)}.door .f-paper{fill:var(--paper)}
.door .s-act{stroke:var(--orange)}.door .s-rule{stroke:var(--rule)}
.door .sh{filter:drop-shadow(0 6px 9px rgba(25,25,25,.08))}
.door .wire{fill:none;stroke:var(--orange);stroke-opacity:.55;stroke-width:1.4}
.door .wire.act,.door .ln-act{fill:none;stroke:var(--orange);stroke-opacity:1;stroke-width:1.8}
.door .ln{fill:none;stroke:var(--orange);stroke-opacity:.55;stroke-width:1.4}
.door .dash{fill:none;stroke:var(--orange);stroke-width:1.6;stroke-dasharray:5 5}
.door .dash-box{fill:none;stroke:var(--ink-3);stroke-dasharray:4 4}
.door .halo{fill:none;stroke:var(--orange);stroke-opacity:.18}
/* the door on a phone: the same facts as a list */
.door-note{margin:8px 4px 0;font-size:13.5px;line-height:1.45;color:var(--ink-2)}.door-note b{color:var(--ink);font-weight:600}
.door-list{display:none;padding:14px}
.door-list .dh{font:400 11.5px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);margin:14px 4px 8px}
.door-list .dh:first-child{margin-top:4px}
.door-list .row{background:var(--card);border-radius:14px;box-shadow:var(--sh-s);padding:12px 14px;margin:0 0 8px}
.door-list .row>b{display:block;font:600 14.5px/1.3 var(--sans);overflow-wrap:anywhere}
.door-list .row span b{font-weight:600;color:var(--ink)}
.door-list .row span{display:block;font:400 12px/1.5 var(--mono);color:var(--ink-2);overflow-wrap:anywhere}
.door-list .row.no{box-shadow:inset 0 0 0 1.6px var(--orange)}
.door-list .row.no span i{font-style:normal;color:var(--orange-dark);font-weight:500}
.door-list .row.z{box-shadow:inset 0 0 0 2px var(--orange)}
/* the three findings */
.finds{display:grid;grid-template-columns:repeat(3,1fr);gap:32px;padding:14px 0 0;margin:0;list-style:none}
.find{font-size:14.5px;line-height:1.5;color:var(--ink-2);min-width:0}
.find p{margin:0}
.find .n{display:block;font:500 11.5px/1 var(--mono);letter-spacing:.1em;color:var(--orange-dark);font-style:normal;margin-bottom:8px}
.find b{color:var(--ink);font-weight:600}
.find code{overflow-wrap:anywhere}
.find a{color:var(--ink)}
/* the action row */
.act{margin-top:12px;border-top:1px solid var(--rule-soft);padding:14px 0 24px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:36px;align-items:center}
.act .head{display:flex;align-items:baseline;gap:12px;margin:0;max-width:none;min-width:0}
.act h2{font:600 16px/1.3 var(--sans);margin:0;white-space:nowrap}
.act .where{font:400 12.5px/1.3 var(--mono);color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.codeline{background:var(--dark);color:var(--on-dark);border-radius:12px;padding:10px 12px 10px 20px;margin-top:8px;min-width:0;display:flex;justify-content:space-between;align-items:center;gap:16px}
.codeline code{display:block;font:400 14.5px/1.5 var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;-webkit-user-select:all;user-select:all;min-width:0}
.codeline .kw{color:var(--dark-key)}
.codeline a{color:var(--on-dark)}
button.copy{font:500 12.5px/1 var(--mono);background:var(--copy);color:var(--dark);border:0;border-radius:99px;padding:9px 14px;cursor:pointer;flex:none}
button.copy:hover{background:var(--dark-key)}button.copy.ok{background:var(--copy-ok)}
.act .r{text-align:center}
.act .sub{display:block;margin-top:9px;font-size:12.5px;color:var(--ink-2);text-decoration:none}
/* in plain words */
.card{background:var(--card);border-radius:var(--r);box-shadow:var(--sh-s);border:1px solid var(--rule-soft);padding:8px 24px;min-width:0}
.band.white .card{background:var(--paper);border-color:transparent;box-shadow:none}
.card+.card,.sec .card+p,.sec .card+.say,.card+dialog+p{margin-top:16px}
.sec .q{margin:28px 0}
.acts td:first-child{width:34%}
.acts td.n{font:400 13px/1.6 var(--mono);color:var(--ink-2);overflow-wrap:anywhere}
.acts .pill-tag{margin:0 0 6px}
.cond{margin:16px 0 0;font-size:14px;color:var(--ink-2)}
.head.c+.card+.cond{text-align:center}
.og{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:64px;align-items:center}
.band.ink h2{color:var(--on-dark)}
.band.ink h2 span{color:var(--dark-com)}
.band.ink .eyebrow{color:var(--on-dark-3)}
.band.ink p{color:var(--on-dark-2);font-size:17px;margin:16px 0 0}
.band.ink .fine{font:400 13px/1.65 var(--mono);color:var(--on-dark-3);margin-top:22px}
.band.ink .fine code{color:var(--on-dark);font-size:1em}
.band.ink a{color:var(--on-dark)}
.vec{background:var(--orange);border-radius:var(--r);padding:18px 22px;margin:0 0 12px;font-size:16px;line-height:1.5;color:var(--dark);font-weight:500}
.vec:last-child{margin:0}
.vec i{display:block;font:500 12px/1 var(--mono);color:#2E1604;font-style:normal;margin-bottom:8px;letter-spacing:.04em;text-transform:uppercase}
.vec code{color:var(--dark);font-weight:500}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:0;padding:0;list-style:none}
.tile{background:var(--paper);border-radius:var(--r);padding:24px}
.tile b{display:block;font:600 18px/1.3 var(--sans);margin:0 0 8px}
.tile span{color:var(--ink-2);font-size:15px;line-height:1.5}
/* the technical divider */
.divider{background:var(--paper);padding:72px 0 0;text-align:center}
.divider .eyebrow{justify-content:center}
.divider h2{font-size:38px}
.divider p{color:var(--ink-2);margin:12px auto 0;max-width:40em}
/* a technical section */
.sec>div{min-width:0}
.sec h3{font:600 20px/1.3 var(--sans);margin:32px 0 12px}
.sec h3 span{color:var(--ink-3)}
.skgroup+.skgroup,.okline+.skgroup{margin-top:32px}.skgroup h3{margin:0}.skgroup>.say{margin:8px 0 16px}
table.skills .load{display:block}table.skills .load+.load{margin-top:8px}table.skills small.n{display:block;margin:0 0 6px;color:var(--ink)}table.skills .pills{display:flex;flex-wrap:wrap;align-items:flex-start;align-content:flex-start;gap:6px;line-height:1}table.skills .pills .tag{margin:0;vertical-align:0}table.skills .names{display:block;line-height:1.7}table.skills .names code{white-space:nowrap}table.skills .pills+.names,table.skills .names+small.absent,table.skills .pills+small.absent{display:block;margin-top:8px}table.skills small.absent{display:block}
.sec>div>h3:first-child{margin-top:0}
.sec p{margin:0 0 10px;font-size:15px}
.sec p.intro{margin:-12px 0 32px;font-size:17px;color:var(--ink-2)}
.sec p code,.sec li code{overflow-wrap:anywhere}
.say,.sec p.say{margin:16px 0 0;font-size:14.5px;color:var(--ink-2)}
.say b{color:var(--ink)}
.muted{color:var(--ink-2)}.small{font-size:13px}.warn{color:var(--ink);font-weight:500}.irrev{font-weight:500}
/* what was read */
.limits{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:0 0 16px}
.limits>div{background:var(--card);border:1px solid var(--rule-soft);border-radius:var(--r);padding:20px 22px;min-width:0}
.limits b{font:500 30px/1 var(--mono);display:block;letter-spacing:-.01em}
.limits span{display:block;margin-top:8px;font-size:13.5px;line-height:1.45;color:var(--ink-2)}
/* each group one full-width card, stacked: its title across the top, its sentences side by side, so a long group never leaves
   an empty column beside a short one */
.cols{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
.col{background:var(--card);border:1px solid var(--rule-soft);border-radius:var(--r);padding:20px 22px;min-width:0;break-inside:avoid}
.band.white .col,.band.white .limits>div{background:var(--paper);border-color:transparent}
.sec .col h3{font:600 15px/1.3 var(--sans);color:var(--ink);margin:0 0 10px}
.col ul{margin:0;padding:0;list-style:none;font-size:14px;line-height:1.5;color:var(--ink-2);display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px 24px;align-items:start}
.col li{padding:0 0 0 14px;border-left:1px solid var(--rule-soft);overflow-wrap:anywhere;min-width:0}
.notes{margin:14px 0 0;padding:0;list-style:none;font-size:14px;color:var(--ink-2)}
.notes li{margin:0 0 8px}
.notes li b{color:var(--ink);font-weight:600}
/* tables, always in a card */
table{width:100%;border-collapse:collapse;font-size:14.5px}
th{font:400 12px/1.2 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);text-align:left;padding:16px 16px 12px 0;border-bottom:1px solid var(--rule);vertical-align:bottom}
th a{color:inherit}
td{padding:15px 16px 15px 0;border-bottom:1px solid var(--rule-soft);vertical-align:top;overflow-wrap:anywhere}
tr:last-child td{border-bottom:0}
td b{font-weight:600}
td .m,td code{font:400 13px/1.5 var(--mono)}
td b.m{font-weight:500}
td small{display:block;font:400 12.5px/1.5 var(--mono);color:var(--ink-2);margin-top:2px}
.tag{display:inline-block;font:500 12px/1 var(--mono);padding:6px 10px;border-radius:99px;background:var(--paper);color:var(--ink-2);white-space:nowrap;vertical-align:1px}
.band.white .tag{background:var(--card);box-shadow:inset 0 0 0 1px var(--rule)}
.tag.no,.band.white .tag.no{background:var(--orange);color:var(--dark);box-shadow:none}
.tag.held,.band.white .tag.held{background:var(--ink);color:var(--paper);box-shadow:none}
.tag.act,.band.white .tag.act{background:var(--act-tint);color:var(--ink);box-shadow:none}
table.app th:nth-child(1){width:17%}table.app th:nth-child(2){width:50%}
table.cover th:nth-child(1){width:24%}table.cover th:nth-child(2){width:46%}
table.entries th:nth-child(1){width:30%}table.entries th:nth-child(2){width:28%}
table.entries .reach{display:block;color:var(--ink);font-weight:600}
table.atlas td:first-child{width:30%}
table.undotable th:nth-child(1){width:23%}table.undotable th:nth-child(2){width:22%}table.undotable th:nth-child(3){width:27%}
table.leaktable b.m{display:block;margin-top:10px}table.leaktable td>b.m:first-child{margin-top:0}
.sec p.members{margin-top:18px}
.act-text{color:var(--orange-dark)}
/* code: the dark card */
.code{background:var(--dark);border-radius:var(--r);overflow:hidden;color:var(--on-dark);margin:0;min-width:0}
.code .bar{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px 10px 20px;border-bottom:1px solid var(--dark-rule);font:400 12.5px/1 var(--mono);color:var(--dark-bar)}
.code .bar b{color:var(--on-dark);font-weight:500}
.code pre{margin:0;padding:18px 20px;font:400 13px/1.7 var(--mono);overflow-x:auto;tab-size:2}
.code pre code{font:inherit;white-space:pre;-webkit-user-select:all;user-select:all}
.code .c,dialog.code .c{color:var(--dark-com)}.code .k,dialog.code .k{color:var(--dark-key)}
.code pre.head{max-height:250px;overflow:hidden;-webkit-mask-image:linear-gradient(#000 65%,transparent);mask-image:linear-gradient(#000 65%,transparent)}
.code pre.head code{-webkit-user-select:none;user-select:none}
.code button.more{display:block;width:100%;text-align:center;padding:14px;border:0;border-top:1px solid var(--dark-rule);background:none;font:500 12.5px/1 var(--mono);color:var(--dark-key);cursor:pointer}
.code button.more:hover{background:#221F1B}
/* put ZIFFER in place: steps as rows */
.steps{list-style:none;margin:0;padding:0}
.step{display:grid;grid-template-columns:300px minmax(0,1fr);gap:40px;padding:28px 0;border-top:1px solid var(--rule-soft);align-items:start}
.step:first-child{border-top:0;padding-top:0}
.step h3{font:600 20px/1.3 var(--sans);margin:0 0 8px}
.step p{margin:0 0 10px;color:var(--ink-2);font-size:15px}
.step p b,.step p code{color:var(--ink)}
.step .badge{display:inline-block;font:500 12px/1 var(--mono);color:var(--orange-dark);background:var(--orange-tint);border-radius:99px;padding:6px 10px;margin-bottom:12px}
.step .side{min-width:0}
.step .side>p{margin-top:14px}
/* a step with no card: one compact row, its action at the right end (the same padding keeps the rhythm of the two-column steps) */
.step.compact{grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:center}
.step.compact .st{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 8px}
.step.compact .st .badge,.step.compact .st h3{margin:0}
.step.compact p:last-child{margin-bottom:0}
.step .end{min-width:0}
a.textbtn{font:500 12.5px/1 var(--mono);color:var(--orange-dark);text-decoration:none;white-space:nowrap}
a.textbtn:hover{text-decoration:underline}
.after{margin:32px 0 0}
.after h3{margin:0 0 14px}
.after ol{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.after ol li{background:var(--card);border:1px solid var(--rule-soft);border-radius:var(--r);padding:20px 22px;font-size:15px;color:var(--ink-2)}
/* the checklist */
.q{margin:0 0 28px}
.q:last-child{margin-bottom:0}
.q-h{display:flex;align-items:center;gap:12px;margin:0 0 8px;flex-wrap:wrap}
.q-h h3{font:600 20px/1.3 var(--sans);margin:0}
.q-h .c,.count{display:inline-block;font:500 12px/1 var(--mono);padding:6px 10px;border-radius:99px;background:var(--ink);color:var(--paper);white-space:nowrap}
.q-note{font-size:14.5px;color:var(--ink-2);margin:0 0 12px}
table.chk{table-layout:fixed}
table.chk th:nth-child(1),table.chk td:nth-child(1){width:36px;padding-right:0}
table.chk th:nth-child(2){width:21%}table.chk th:nth-child(3){width:25%}table.chk th:nth-child(4){width:13%}
table.chk th:nth-child(5){width:14%}table.chk th:nth-child(6){width:9%}
span.box{display:inline-block;width:16px;height:16px;border:1.5px solid var(--ink-3);border-radius:5px;vertical-align:-3px}
.ev{font:400 13px/1.5 var(--mono);color:var(--ink-2)}
.ev q{quotes:none;color:var(--ink)}
.ck{font:500 12.5px/1.5 var(--mono);color:var(--ink)}
.ck.no{color:var(--orange-dark)}
details.rows>summary,details.fold>summary,details.inner>summary{list-style:none;cursor:pointer;font:500 12.5px/1 var(--mono);color:var(--ink-2);padding:14px 0 12px}
details.rows>summary::-webkit-details-marker,details.fold>summary::-webkit-details-marker,details.inner>summary::-webkit-details-marker{display:none}
details.rows>summary:before,details.fold>summary:before,details.inner>summary:before{content:"+ "}
details[open].rows>summary:before,details[open].fold>summary:before,details[open].inner>summary:before{content:"- "}
details.inner{margin:12px 0}
.box-note{background:var(--card);border:1px solid var(--rule-soft);border-radius:var(--r);padding:18px 22px;margin:0 0 18px;font-size:15px;color:var(--ink-2)}
.band.white .box-note{background:var(--paper);border-color:transparent}
.box-note b{color:var(--ink)}
.box-note.no,.band.white .box-note.no{background:var(--orange-tint);border-color:transparent;color:var(--ink)}
.box-note p{margin:0 0 6px}.box-note p:last-child{margin:0}
.placeholder{border:1px dashed var(--ink-3);border-radius:var(--r);padding:14px 18px;margin:10px 0;font-size:14.5px}
ul.plain{margin:0 0 10px;padding:0;list-style:none}
ul.plain>li{padding:12px 0;border-bottom:1px solid var(--rule-soft)}
ul.plain>li:first-child{padding-top:0}
ul.plain>li:last-child{border-bottom:0}
.excerpt{font:400 12.5px/1.5 var(--mono);color:var(--ink-2)}
.okline{display:flex;gap:12px;align-items:flex-start;background:var(--card);border:1px solid var(--rule-soft);border-radius:var(--r);padding:20px 24px;color:var(--ink-2);font-size:15px;margin:0 0 16px}
.band.white .okline{background:var(--paper);border-color:transparent}
.okline b{color:var(--ink);font-weight:600}
/* buttons that open a dialog */
button.morebtn{display:block;width:100%;text-align:left;background:none;border:0;border-top:1px solid var(--rule-soft);font:500 12.5px/1 var(--mono);color:var(--orange-dark);padding:16px 0 14px;cursor:pointer}
button.morebtn:hover,button.appx:hover span{text-decoration:underline}
button.appx{width:100%;cursor:pointer;text-align:left;color:var(--ink);background:var(--card);border:1px solid var(--rule-soft);border-radius:var(--r);padding:22px 24px;display:flex;justify-content:space-between;align-items:center;gap:16px;font:600 17px/1.3 var(--sans)}
button.appx span{font:500 12.5px/1 var(--mono);color:var(--orange-dark)}
button.appx+button.appx,button.appx+details.app,details.app+button.appx{margin-top:12px}
/* dialogs: the whole module, a whole group, every tool */
dialog{border:0;border-radius:var(--r-lg);padding:0;width:min(1040px,92vw);max-height:86vh;background:var(--card);color:var(--ink);box-shadow:0 30px 80px rgba(0,0,0,.35)}
dialog::backdrop{background:rgba(25,25,25,.55)}
dialog .dh{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:18px 22px;border-bottom:1px solid var(--rule-soft);position:sticky;top:0;background:var(--card);z-index:2}
dialog .dh b{font:600 17px/1.3 var(--sans)}
dialog .dh small{font:400 12.5px/1 var(--mono);color:var(--ink-2);margin-left:10px}
dialog button.x{font:500 12.5px/1 var(--mono);background:var(--paper);color:var(--ink);border:0;border-radius:99px;padding:9px 14px;cursor:pointer}
dialog .db{padding:6px 22px 22px}
dialog thead th{position:sticky;top:61px;background:var(--card);z-index:1}
/* dialog.code also matches .code (the inline dark card: margin:0, overflow:hidden), which would pin the modal to the
   top-left corner and cut its content off; the dialog restates the browser's centring and its own scrolling. */
dialog.code{background:var(--dark);color:var(--on-dark);margin:auto;overflow:auto;border-radius:var(--r-lg)}
dialog.code .dh{background:var(--dark);border-color:var(--dark-rule)}
dialog.code .dh b{color:var(--on-dark)}
dialog.code .dh small{color:var(--dark-bar)}
dialog.code pre{margin:0;padding:18px 0;font:400 13px/1.7 var(--mono);white-space:pre;overflow-x:auto}
/* the appendix and the legend: collapsed cards */
details.app{background:var(--card);border:1px solid var(--rule-soft);border-radius:var(--r)}
details.app+details.app{margin-top:12px}
details.app>summary{list-style:none;cursor:pointer;padding:22px 24px;display:flex;justify-content:space-between;align-items:center;gap:16px;font:600 17px/1.3 var(--sans)}
details.app>summary::-webkit-details-marker{display:none}
/* the same label as the appendix row beside it (button.appx span): "Open", in orange */
details.app>summary span.o,details.app>summary span.c{font:500 12.5px/1 var(--mono);color:var(--orange-dark);white-space:nowrap}
details.app[open]>summary span.o{display:none}details.app:not([open])>summary span.c{display:none}
details.app>.in{padding:0 24px 24px}
dl.terms{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 32px;margin:0 0 18px}
.term-row dt{font-weight:600;font-size:14.5px}.term-row dd{margin:0;font-size:14px;color:var(--ink-2)}
.spec{font:400 11.5px var(--mono);color:var(--ink-2);border-radius:99px;background:var(--paper);padding:2px 7px}
.minis{display:grid;grid-template-columns:1fr 1fr;gap:12px 32px}
table.mini caption{text-align:left;font-weight:600;font-size:14px;padding:0 0 6px}
table.mini th{width:5em;font:500 12px/1.4 var(--mono);color:var(--ink);letter-spacing:0;text-transform:none;border-bottom:1px solid var(--rule-soft);padding:8px 14px 8px 0;vertical-align:top}
table.mini td{padding:8px 0}
a.term{color:inherit;text-decoration:underline dotted;text-underline-offset:3px}
a.clause{font:400 11px var(--mono);padding:2px 7px;border-radius:99px;background:var(--paper);color:var(--ink-2);text-decoration:none;white-space:nowrap}
a.member{color:inherit}
/* footer */
/* the heading across the full width above the list, as every band heading (.head) */
footer.foot{display:block}
footer.foot h2{margin:0 0 32px}
footer.foot ol{margin:0 0 14px;padding-left:20px;font-size:15px}footer.foot li{margin:0 0 8px}
footer.foot .meta-line{font:400 12px/1.6 var(--mono);color:var(--ink-2);margin:14px 0 0;overflow-wrap:anywhere}
@media screen and (min-width:901px){table.skills.app th.c-name{width:19%}table.skills.app th.c-found{width:27%}table.skills.app th.c-can{width:13%}table.skills.app th.c-hits{width:11%}}
@media screen and (max-width:900px){
.band{padding:48px 0}
.mast .meta span{display:none}
.hero .g,.og,.act,.step{grid-template-columns:1fr;gap:20px}
.finds,.tiles,.after ol,.cols{grid-template-columns:1fr;gap:16px}
.limits{grid-template-columns:1fr 1fr}
h1,h1.long{font-size:30px}
h2{font-size:26px}.divider h2{font-size:30px}
.door svg{display:none}.door-list{display:block}
.act h2{white-space:normal}.act .head{flex-direction:column;gap:2px}
.act .where{white-space:normal;overflow-wrap:anywhere}
.codeline code{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}
.act .r{text-align:left}
dl.terms,.minis{grid-template-columns:1fr}
table,thead,tbody,tr,td,th{display:block}
thead{display:none}
tr{padding:14px 0;border-bottom:1px solid var(--rule-soft)}tr:last-child{border-bottom:0}
td{border:0;padding:2px 0;width:auto !important}
td[data-l]:before{content:attr(data-l);display:block;font:400 11px/1.4 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin-top:6px}
table.chk tr{display:grid;grid-template-columns:28px minmax(0,1fr);gap:0 8px}
table.chk td{grid-column:2}table.chk td:first-child{grid-column:1;grid-row:1 / span 6}
td:empty{display:none}
table.mini tr{display:grid;grid-template-columns:5em minmax(0,1fr)}
.card{padding:4px 18px}
.code pre{font-size:12px}
}
@media screen and (max-width:700px){.col ul,.step.compact{grid-template-columns:minmax(0,1fr)}.step.compact{gap:14px}}
@media print{
@page{size:A4;margin:12mm 12mm 14mm}
@page cover{size:A4 landscape;margin:8mm}
html,body{background:#fff}
.wrap{max-width:none;padding:0}
.first{page:cover;break-after:page;page-break-after:always;zoom:.78}
.rest{zoom:.8}
.band{padding:24px 0}
.divider{break-before:page;padding-top:0}
tr,.find,.code,.vec,.tile,.col,.limits>div,.q-h,.box-note,.placeholder{break-inside:avoid}
h2,h3{break-after:avoid}
.band.ink,.band.white,.door,.tag,.cta,.pill,.codeline,.code,.scale li,.grade,h1 em{print-color-adjust:exact;-webkit-print-color-adjust:exact}
.door svg{display:block}.door-list{display:none}
.code pre{overflow:visible;white-space:pre-wrap}
.code pre code{white-space:pre-wrap}
details.app:not([open])::details-content{content-visibility:hidden;display:none}
button.copy,button.more,button.morebtn,button.x{display:none}
dialog,dialog.code{display:block;position:static;width:auto;max-height:none;box-shadow:none;border-radius:0;margin:16px 0 0}
}
/* without script (a mail client's preview), a dialog's content is shown where it stands: nothing is out of reach; it comes after dialog.code at equal specificity, so it wins there too */
.noscript dialog{display:block;position:static;width:auto;max-height:none;box-shadow:none;margin:16px 0 0}
`;

/**
 * Every colour pair the page writes on a dark or an orange ground, and the tags: the text and its
 * ground, as tokens of `TOKENS` or as the literal the stylesheet uses. `contrast` in `file.test.ts`
 * reads each value out of the stylesheet itself and holds it to WCAG AA (4.5:1 for text).
 */
export const GROUND_PAIRS: readonly { where: string; fg: string; bg: string }[] = [
  { where: 'code text', fg: '--on-dark', bg: '--dark' },
  { where: 'code keyword', fg: '--dark-key', bg: '--dark' },
  { where: 'code comment', fg: '--dark-com', bg: '--dark' },
  { where: 'code bar', fg: '--dark-bar', bg: '--dark' },
  { where: 'Copy button', fg: '--dark', bg: '--copy' },
  { where: 'Copy button, copied', fg: '--dark', bg: '--copy-ok' },
  { where: 'steer band heading', fg: '--on-dark', bg: '--dark' },
  { where: 'steer band heading, second half', fg: '--dark-com', bg: '--dark' },
  { where: 'steer band sentence', fg: '--on-dark-2', bg: '--dark' },
  { where: 'steer band fine print', fg: '--on-dark-3', bg: '--dark' },
  { where: 'steer card', fg: '--dark', bg: '--orange' },
  { where: 'steer card label', fg: '#2E1604', bg: '--orange' },
  { where: 'button', fg: '--dark', bg: '--orange' },
  { where: 'tag NO CHECK FOUND', fg: '--dark', bg: '--orange' },
  { where: 'tag held', fg: '--paper', bg: '--ink' },
  { where: 'tag of a tool held for a person, in a skill row', fg: '--ink', bg: '--act-tint' },
  { where: 'tag on paper', fg: '--ink-2', bg: '--paper' },
  { where: 'tag on white', fg: '--ink-2', bg: '--card' },
];

/** The whole stylesheet: the embedded faces, the tokens, the page. */
export function reportStyle(): string {
  return `${fontFaces()}\n${TOKENS}\n${PAGE}`;
}

/**
 * The nav on the page without `--code`, so the two reports are one product: the same logo size, the
 * same mono meta line, the same pill button, the same rule under it. That page's own layout is its
 * stylesheet's (`file.ts`), in the same bands and cards.
 */
export const MAST_STYLE = `
.mast{border-bottom:1px solid var(--rule-soft);background:var(--paper)}
.mast .wrap{display:flex;align-items:center;justify-content:space-between;gap:24px;height:64px;max-width:1156px;margin:0 auto;padding:0 24px}
.mast svg.logo{height:27px;width:auto;display:block;flex:0 0 auto}
.mast .meta{display:flex;align-items:center;gap:18px;font:400 12.5px/1 ${MONO};color:var(--muted);min-width:0}
.mast .meta span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mast .meta b{font-weight:400}
.mast .pill{display:inline-flex;align-items:center;border-radius:99px;font:500 14.5px/1 ${SANS};padding:13px 20px;text-decoration:none;white-space:nowrap;background:var(--orange);color:#191919}
@media screen and (max-width:900px){.mast .meta span{display:none}}
@media print{.mast .wrap{height:auto;padding:0 0 6px}.mast svg.logo{height:20px}}
`;
