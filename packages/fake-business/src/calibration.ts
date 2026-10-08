import type { IndustryId } from "./schema.js";
import type { IndustryProfile } from "./industries/types.js";

export interface Calibration {
  cbp: { year: number; naics: string; naicsVintage: number; employees: number; establishments: number; employeesPerEstablishment: number };
  susb: { year: number; firms: number; firmsUnder20: number; smallFirmShare: number };
  oews: { year: number; naics: string; occupation: string; medianHourlyCents: number };
  proxy: boolean;
  sources: { dataset: string; url: string; selection: string }[];
  limitations: string;
}

const CBP = "https://www2.census.gov/programs-surveys/cbp/datasets/2023/cbp23us.zip";
const SUSB = "https://www2.census.gov/programs-surveys/susb/tables/2022/us_state_naics_detailedsizes_2022.txt";
function profile(naics: string, employees: number, establishments: number, firms: number, firmsUnder20: number, wageNaics: string, occupation: string, wage: number, proxy = false): Calibration {
  return {
    cbp: { year: 2023, naics, naicsVintage: 2017, employees, establishments, employeesPerEstablishment: employees / establishments },
    susb: { year: 2022, firms, firmsUnder20, smallFirmShare: firmsUnder20 / firms },
    oews: { year: 2023, naics: wageNaics, occupation, medianHourlyCents: wage }, proxy,
    sources: [
      { dataset: "Census CBP 2023", url: CBP, selection: `cbp23us.txt; uscode=98; lfo=-; naics=${naics}; emp/est; employment noise flag G` },
      { dataset: "Census SUSB 2022", url: SUSB, selection: `STATE=00; NAICS=${naics}; FIRM sum ENTRSIZE02-05 / ENTRSIZE01` },
      { dataset: "BLS OEWS May 2023", url: `https://www.bls.gov/oes/2023/may/naics${wageNaics.length === 6 && wageNaics.endsWith("00") ? "4" : "5"}_${wageNaics}.htm`, selection: `SOC ${occupation}; median hourly wage` },
    ],
    limitations: "Employer aggregates, not SMB-only or self-employed populations. Medium active staffing is rounded CBP employees per establishment; other sizes, roles, prices, lead volumes and event rates remain illustrative. Wage and small-firm share are recorded references, not payroll records or a fitted distribution.",
  };
}

export const CALIBRATION: Readonly<Record<IndustryId, Calibration>> = {
  "home-services": profile("238220", 1214761, 111207, 107004, 96222, "238220", "49-9021", 2620),
  "dental-clinic": profile("621210", 1028889, 135665, 120488, 113495, "621200", "31-9091", 2239),
  "marketing-agency": profile("541810", 200465, 15512, 13682, 12411, "541800", "13-1161", 3148, true),
  "trailer-dealer": profile("441228", 74882, 6688, 5965, 4834, "441200", "41-2031", 1938, true),
};
CALIBRATION["trailer-dealer"].limitations += " CBP/SUSB use 2017 NAICS441228; utility trailers fall in broader 2022 NAICS441227, while travel trailers are441210. OEWS441200 is broader still.";
CALIBRATION["marketing-agency"].limitations += " OEWS541800 includes advertising, public relations and related services, broader than Census541810.";

/** Adjust only the largest medium role; preserve the profile's roles and every other size. */
export function calibratedProfile(profile: IndustryProfile): IndustryProfile {
  const target = Math.round(CALIBRATION[profile.id].cbp.employeesPerEstablishment);
  const total = profile.roster.reduce((sum, role) => sum + role.medium, 0);
  const largest = profile.roster.reduce((best, role, index) => role.medium > profile.roster[best]!.medium ? index : best, 0);
  const roster = profile.roster.map((role, index) => index === largest ? { ...role, medium: role.medium + target - total } : { ...role });
  if (roster.some((role) => role.medium < 0)) throw new RangeError("Calibration cannot remove required staffing");
  return { ...profile, roster };
}
