// Tiny offline spell helper. No dictionary download and no network calls:
// the browser's own spellcheck underlines words in the text box, and this
// adds a short list of very common misspellings with one-tap fixes.

const COMMON = `
accross:across acheive:achieve accomodate:accommodate acommodate:accommodate adress:address
agressive:aggressive amatuer:amateur apparantly:apparently appearence:appearance
arguement:argument awkard:awkward basicly:basically becuase:because becasue:because begining:beginning
beleive:believe belive:believe buisness:business calender:calendar camoflage:camouflage
catagory:category cemetary:cemetery collegue:colleague colleage:colleague comming:coming
commited:committed committment:commitment concious:conscious copywrite:copyright definately:definitely
definitly:definitely dissapoint:disappoint dissapear:disappear embarass:embarrass
enviroment:environment existance:existence experiance:experience familar:familiar finaly:finally
foriegn:foreign freind:friend frist:first goverment:government grammer:grammar gaurd:guard happend:happened
harrass:harass heighth:height hygene:hygiene ignorence:ignorance immediatly:immediately independant:independent
interupt:interrupt irrelevent:irrelevant jist:gist knowlege:knowledge
liason:liaison libary:library lisence:license maintainance:maintenance managment:management
millenium:millennium mischievious:mischievous mispell:misspell neccessary:necessary necesary:necessary
 noticable:noticeable occassion:occasion occured:occurred occurence:occurrence
ocurred:occurred offically:officially oppurtunity:opportunity paralel:parallel pavillion:pavilion
peice:piece perseverence:perseverance persue:pursue posession:possession prefered:preferred
presentaion:presentation privelege:privilege probly:probably publically:publicly realy:really
recieve:receive recieved:received reccomend:recommend recomend:recommend refered:referred relevent:relevant
religous:religious remeber:remember rember:remember resturant:restaurant rythm:rhythm schedual:schedule
seperate:separate sieze:seize similiar:similar sincerly:sincerely speach:speech succesful:successful
successfull:successful suprise:surprise supprise:surprise tatoo:tattoo tendancy:tendency teh:the
thier:their threshhold:threshold tommorow:tomorrow tommorrow:tomorrow tounge:tongue truely:truly
tyrany:tyranny underate:underrate untill:until unusualy:unusually usualy:usually vaccum:vacuum
vegtable:vegetable wierd:weird whereever:wherever wich:which writting:writing youre:you're
dont:don't doesnt:doesn't didnt:didn't isnt:isn't wasnt:wasn't
couldnt:couldn't shouldnt:shouldn't wouldnt:wouldn't
`;

const MAP = new Map(COMMON.trim().split(/\s+/).map((pair) => pair.split(':')));
MAP.set('alot', 'a lot'); // the one fix with a space in it

function matchCase(word, fix) {
  if (word === word.toUpperCase() && word.length > 1) return fix.toUpperCase();
  if (word[0] === word[0].toUpperCase()) return fix[0].toUpperCase() + fix.slice(1);
  return fix;
}

// Returns [{ word, fix, count }] for known misspellings found in the text.
export function findMisspellings(text) {
  const found = new Map();
  for (const m of String(text || '').matchAll(/[A-Za-z][A-Za-z']*/g)) {
    const word = m[0];
    const fix = MAP.get(word.toLowerCase());
    if (!fix) continue;
    const key = word.toLowerCase();
    const prev = found.get(key);
    if (prev) prev.count++;
    else found.set(key, { word, fix: matchCase(word, fix), count: 1 });
  }
  return [...found.values()];
}

// Replaces every case-insensitive whole-word occurrence of `word`, keeping case.
export function applyFix(text, word) {
  const fix = MAP.get(word.toLowerCase());
  if (!fix) return text;
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^A-Za-z'])(${esc})(?![A-Za-z'])`, 'gi');
  return String(text).replace(re, (_, pre, w) => pre + matchCase(w, fix));
}
