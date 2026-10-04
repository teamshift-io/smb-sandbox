/**
 * Curated word lists. Shipped in-package (no Faker) so a given seed produces
 * the same business forever. Names are common US names from many backgrounds;
 * any resemblance to a real person is coincidental.
 */
import type { Timezone } from "./time.js";

export const FIRST_NAMES: readonly string[] = [
  "Aaliyah", "Aaron", "Abigail", "Adriana", "Ahmed", "Aiko", "Alejandro", "Alicia", "Amara", "Amir",
  "Ana", "Andre", "Angela", "Anil", "Anthony", "Arjun", "Aryana", "Ashley", "Ayesha", "Benjamin",
  "Bianca", "Brandon", "Brianna", "Caleb", "Camila", "Carlos", "Carmen", "Catherine", "Chen", "Chloe",
  "Christopher", "Claire", "Cristina", "Daniel", "Darius", "David", "Deepa", "Desmond", "Diana", "Diego",
  "Dmitri", "Elena", "Elijah", "Elizabeth", "Emeka", "Emily", "Esperanza", "Ethan", "Fatima", "Felipe",
  "Gabriel", "Grace", "Hana", "Hannah", "Hassan", "Hector", "Imani", "Isabel", "Isaiah", "Jacob",
  "Jamal", "Jasmine", "Javier", "Jennifer", "Jessica", "Jin", "Jonathan", "Jordan", "Jose", "Joseph",
  "Joy", "Julian", "Kai", "Kalani", "Katherine", "Keisha", "Kenji", "Kevin", "Kiara", "Lakshmi",
  "Lauren", "Leila", "Liam", "Lily", "Lucia", "Luis", "Malik", "Margaret", "Maria", "Marcus",
  "Maya", "Mei", "Michael", "Miguel", "Mohammed", "Monique", "Nadia", "Naomi", "Nathan", "Nia",
  "Nicholas", "Nikhil", "Noah", "Olivia", "Omar", "Patricia", "Priya", "Rafael", "Rahul", "Rashida",
  "Rebecca", "Ricardo", "Robert", "Rosa", "Ryan", "Samantha", "Samuel", "Sanjay", "Sara", "Sebastian",
  "Sofia", "Soo-ah", "Stephanie", "Tamika", "Tariq", "Teresa", "Thomas", "Tiana", "Tomas", "Trevor",
  "Valentina", "Victoria", "Vikram", "Wei", "William", "Xavier", "Yara", "Yusuf", "Zainab", "Zoe",
];

export const LAST_NAMES: readonly string[] = [
  "Abbott", "Acosta", "Adeyemi", "Aguilar", "Ahmed", "Alvarez", "Anderson", "Arora", "Bailey", "Banerjee",
  "Barnes", "Becker", "Bell", "Bennett", "Bhatt", "Brooks", "Bryant", "Castillo", "Castro", "Chang",
  "Chavez", "Chen", "Cho", "Coleman", "Collins", "Cruz", "Delgado", "Diaz", "Dubois", "Edwards",
  "Ellis", "Espinoza", "Evans", "Farouk", "Fernandez", "Fischer", "Flores", "Foster", "Fujimoto", "Garcia",
  "Gomez", "Gonzalez", "Greene", "Gupta", "Gutierrez", "Haddad", "Hall", "Harris", "Hayes", "Herrera",
  "Hoang", "Hughes", "Ibrahim", "Iyer", "Jackson", "Jenkins", "Jimenez", "Johnson", "Kang", "Kaur",
  "Kelly", "Khan", "Kim", "Kowalski", "Kumar", "Lam", "Lee", "Lewis", "Li", "Lin",
  "Lopez", "Mahmoud", "Martinez", "Mendoza", "Mensah", "Miller", "Mitchell", "Molina", "Morales", "Moreno",
  "Murphy", "Nakamura", "Nguyen", "Novak", "Nwosu", "Obi", "Okafor", "Olsen", "Ortiz", "Owusu",
  "Park", "Patel", "Perez", "Petrov", "Pham", "Powell", "Price", "Quinn", "Ramirez", "Ramos",
  "Reddy", "Reyes", "Rivera", "Robinson", "Rodriguez", "Romero", "Rossi", "Russo", "Saito", "Salazar",
  "Sanchez", "Santos", "Schmidt", "Shah", "Silva", "Singh", "Sokolov", "Soto", "Stewart", "Suarez",
  "Sullivan", "Tanaka", "Taylor", "Thapa", "Thomas", "Torres", "Tran", "Turner", "Vargas", "Vasquez",
  "Vu", "Walker", "Wang", "Washington", "Watanabe", "Williams", "Wilson", "Wright", "Wu", "Yamamoto",
  "Yang", "Young", "Zhang", "Zhou", "Zielinski",
];

/** Formal name → common short form, used for near-duplicate contacts. */
export const NICKNAMES: Readonly<Record<string, string>> = {
  Abigail: "Abby", Alejandro: "Alex", Anthony: "Tony", Benjamin: "Ben", Catherine: "Cathy",
  Christopher: "Chris", Cristina: "Tina", Daniel: "Dan", David: "Dave", Elizabeth: "Liz",
  Esperanza: "Espe", Gabriel: "Gabe", Jacob: "Jake", Jennifer: "Jen", Jessica: "Jess",
  Jonathan: "Jon", Joseph: "Joe", Katherine: "Kate", Margaret: "Maggie", Michael: "Mike",
  Nathan: "Nate", Nicholas: "Nick", Patricia: "Trish", Rebecca: "Becky", Ricardo: "Rick",
  Robert: "Bob", Samantha: "Sam", Samuel: "Sam", Sebastian: "Seb", Stephanie: "Steph",
  Thomas: "Tom", Valentina: "Vale", Victoria: "Tori", William: "Bill", Zainab: "Zee",
};

export const STREET_NAMES: readonly string[] = [
  "Alder", "Aspen", "Bayberry", "Birch Hollow", "Bluebell", "Bramble", "Briar Patch", "Buttonwood",
  "Canary", "Cattail", "Cedar Bluff", "Chestnut", "Clover", "Cobble", "Copperleaf", "Cottonwood",
  "Crabapple", "Dogwood", "Driftwood", "Elmstead", "Fernbrook", "Fieldstone", "Foxglove", "Garnet",
  "Goldenrod", "Hawthorn", "Heron", "Hickory", "Hollyhock", "Ironwood", "Juniper", "Kestrel",
  "Lantern", "Larkspur", "Linden", "Magnolia", "Maple Run", "Marigold", "Meadowlark", "Millstone",
  "Mockingbird", "Mulberry", "Nettle", "Oakmoss", "Orchard", "Osprey", "Partridge", "Pebble Creek",
  "Persimmon", "Pinecone", "Plover", "Primrose", "Quail", "Redbud", "Ridgeview", "Rosemary",
  "Sagebrush", "Sandpiper", "Sassafras", "Shady Elm", "Sorrel", "Sparrow", "Spruce", "Starling",
  "Sumac", "Sweetgum", "Sycamore", "Tamarack", "Thistle", "Timberline", "Tulip", "Willow Bend",
  "Wren", "Yarrow",
];

export const STREET_SUFFIXES: readonly string[] = [
  "St", "Ave", "Ln", "Dr", "Ct", "Rd", "Way", "Pl", "Blvd", "Trl", "Ter", "Cir",
];

export const UNIT_PREFIXES: readonly string[] = ["Apt", "Unit", "Suite"];

/** Invented town names. Paired with a state they form a fictional address. */
export const CITY_NAMES: readonly string[] = [
  "Ashbury Falls", "Bellmont Springs", "Birchford", "Brightwater", "Cedar Hollow", "Clearbrook",
  "Copper Ridge", "Dunmore Heights", "Eastvale", "Elmhurst Glen", "Fairhaven Park", "Foxmoor",
  "Glenwick", "Granite Bend", "Harrow Creek", "Hollis Grove", "Ivy Landing", "Juniper Flats",
  "Kestrel Point", "Lakemont", "Larkfield", "Linden Cross", "Maple Hollow", "Marlow Station",
  "Millbridge", "North Larch", "Oak Terrace", "Orchard Hill", "Pinecrest Valley", "Prairie Gate",
  "Quarry Hill", "Ravenwood", "Redfern", "Riverbend Commons", "Rookwood", "Sablewood",
  "Silver Lake Junction", "Southport Mills", "Stonebrook", "Sumner Falls", "Thornbury", "Tilden Park",
  "Upton Ridge", "Valewood", "Westbrook Hollow", "Whitby Springs", "Willowmere", "Wrenfield",
];

export interface Region {
  state: string;
  timezone: Timezone;
  /** Real area codes; every number is 555-01xx, which is reserved for fiction. */
  areaCodes: readonly string[];
  zipPrefix: string;
}

export const REGIONS: readonly Region[] = [
  { state: "IL", timezone: "America/Chicago", areaCodes: ["312", "773", "630", "847", "708", "815"], zipPrefix: "60" },
  { state: "TX", timezone: "America/Chicago", areaCodes: ["512", "737", "254", "830", "210", "726"], zipPrefix: "78" },
  { state: "MN", timezone: "America/Chicago", areaCodes: ["612", "651", "763", "952", "507", "320"], zipPrefix: "55" },
  { state: "OH", timezone: "America/New_York", areaCodes: ["614", "380", "740", "937", "513", "419"], zipPrefix: "43" },
  { state: "NC", timezone: "America/New_York", areaCodes: ["919", "984", "336", "252", "704", "980"], zipPrefix: "27" },
  { state: "GA", timezone: "America/New_York", areaCodes: ["404", "678", "770", "470", "706", "762"], zipPrefix: "30" },
];

/** Personal email domains, all under the reserved .example TLD (RFC 2606). */
export const MAIL_DOMAINS: readonly string[] = [
  "mailbox.example", "inbox.example", "postbox.example", "webmail.example", "homemail.example",
  "fastmail.example", "letterbox.example",
];

/** Building blocks for fictional business-client names (marketing agency). */
export const BUSINESS_PATTERNS: readonly string[] = [
  "{Last} & {Last2} Law Group",
  "{City} Family Chiropractic",
  "{Adj} {Noun} Bakery",
  "{Last} Landscaping",
  "{Adj} {Noun} Yoga",
  "{City} Pet Hospital",
  "{Last} Brothers Roofing",
  "{Adj} {Noun} Coffee Co.",
  "{Last} Realty Group",
  "{City} Auto Care",
  "{Adj} {Noun} Boutique",
  "{Last} Accounting",
  "{City} Montessori",
  "{Adj} {Noun} Brewing",
  "{Last} Physical Therapy",
  "{Adj} {Noun} Florist",
  "{City} Fitness Studio",
  "{Last} Insurance Agency",
  "{Adj} {Noun} Kitchen",
  "{Last} & Daughters Hardware",
];

export const BUSINESS_ADJECTIVES: readonly string[] = [
  "Amber", "Blue Heron", "Bright", "Cobalt", "Copper", "Golden", "Green Door", "Harbor", "Honeycomb",
  "Iron", "Little", "Lucky", "Northern", "Old Mill", "Red Fox", "Rustic", "Silver", "Sunny", "Tall Pine",
  "Twin Oaks",
];

export const BUSINESS_NOUNS: readonly string[] = [
  "Anchor", "Barn", "Bee", "Bluff", "Cedar", "Compass", "Crow", "Fern", "Field", "Gate", "Hearth",
  "Lantern", "Leaf", "Meadow", "Owl", "Pepper", "Ridge", "Sparrow", "Spoon", "Willow",
];
