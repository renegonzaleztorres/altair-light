/**
 * Tarazed
 * 
 * Utility class for performing prefix-based text replacements.
 * Parses and transforms strings by replacing tokens with matching prefix patterns.
 * 
 * **Tarazed in the night sky**, designated as Gamma Aquilae, Giant star near Altair; forms the “spine” of the eagle.
 * Apparent Magnitude: ~2.7, Distance ~460 light-years from Earth.
 * 
 */

import fs from 'fs/promises';
import path from 'path';

class Tarazed {
  
  constructor({ elemTagPrefix = '@@ELEM_', varTagPrefix = '@@VAR_', paramTagPrefix = '@@PARAM_', appPath = '', readoutCallback = null } = {}) {

    // Error if appPath is missing or blank
    if (typeof appPath !== 'string' || appPath.trim() === '') {
      throw new Error(`Invalid "Tarazed appPath": expected a non-empty string.`);
    }

    this.elemTagPrefix = elemTagPrefix;
    this.varTagPrefix = varTagPrefix;
    this.paramTagPrefix = paramTagPrefix;
    this.appPath = appPath;

  }

  // replaceElemTags : replace element tags in a string with content from file on disk
  // Example: @@ELEM_globals/_nav.html;{"Class":"color-secondary"}
  // - @@ELEM_ is the prefix
  // - globals/_nav.html is a path
  // - ; is the separator (optional)
  // - {"Class":"color-secondary"} is the parameter(s) JSON string (optional)
  // The element tag prefix is case insensitive. The case "sensitivity" of the path is based on the OS (typically Windows and Mac are case insensitive, while Linux is case sensitive).
  // The parameters in the JSON string are case sensitive and will be replaced to blanks if missing
  // (string) s
  replaceElemTags = async (s) => {

    if (typeof s !== 'string'){ return s; }
    let strng = s;
    let matches = null;
    do { // Replace element tags while there are any to replace
      matches = strng.match(new RegExp(this.elemTagPrefix + '[a-zA-Z0-9_.\\-\\/\\\\]*(?:;\\{.*?\\})?', 'gi')); // Matches any alphanumeric chars., underscores, periods, forward slashes & backslashes that immediately follow the prefix, and optional ;{...}
      if (matches && matches.length > 0) {
        let uniqueMatches = new Set(matches);
        for (const t of uniqueMatches) {
          let [fp, o = '{}'] = t.split(';'); // Extract the file path and optional JSON string
          let f = fp.replace(new RegExp(`^${this.elemTagPrefix}`, 'i'), ''); // Prefix removal
          f = path.join(this.appPath, f);
          try {
            let d = await fs.readFile(f, 'utf8'); // UTF-8: (8-bit Unicode Transformation Format)
            if (o) {
              try{
                let params = JSON.parse(o);
                d = this.replaceParamTags(d, params);
              } catch{}
            } // if
            strng = strng.replace(new RegExp(t, 'g'), d); // Replacement
          } 
          catch (err) {
            if (this.readoutCallback !== null)
              this.readoutCallback(`Reading file ${f} > ${err}`, 'Error');
            strng = strng.replace(new RegExp(t, 'g'), 'UNDEFINED'); // Replacement
          } // try
        } // for
      } // if
    }
    while (matches && matches.length > 0);

    return strng;

  } // replaceElemTags

  // replaceVarTags : replace variable tags in a string with corresponding static|dynamic values (use any case for the tags but the variables being matched will be in lowercase)
  // Example(s): @@VAR_YEAR @@VAR_Year @@VAR_year @@VAR_Year-Month @@VAR_Year_Month @@VAR_YearMonth
  // - @@VAR_ is the prefix
  // - YEAR is the variable 
  // (string) s
  // (object) vD : var definitions - all keys should be in lowercase. Underscores and hyphens are allowed
  replaceVarTags = (s, vD = {}) => {
    if (typeof s !== 'string'){ return s; }
    let strng = s;
    let matches = strng.match(new RegExp(`${this.varTagPrefix}[\\w-]+`, 'gi')); // Matches ONLY alphanumeric chars, underscores and hyphens that immediately follow the prefix
    if (matches) {
      let uniqueMatches = new Set(matches);
      for (const t of uniqueMatches) {
        let k = t.replace(new RegExp(`^${this.varTagPrefix}`, 'i'), '').toLowerCase(); // Prefix removal
        let v = vD[k] ?? 'UNDEFINED';
        let safeTag = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape special chars in tag for use in RegExp
        strng = strng.replace(new RegExp(safeTag, 'g'), v); // Replacement
      } // for
    } // if

    return strng;

  } // replaceVarTags

  // replaceParamTags : replace parameter tags in a string with corresponding values from an object (case sensitive!)
  // Example: @@PARAM_Class, @@PARAM_box_color, @@PARAM_box-color, ...
  // - @@PARAM_ is the prefix
  // - Class is the parameter
  // (string) s
  // (object) params
  replaceParamTags = (s, params) => {

    if (typeof s !== 'string'){ return s; }
    let strng = s;
    let matches = strng.match(new RegExp(this.paramTagPrefix + '[a-zA-Z0-9_-]+', 'gi')); // Matches ONLY alphanumeric chars., underscores and dashes that immediately follow the prefix
    if (matches) {
      let uniqueMatches = new Set(matches);
      for (const t of uniqueMatches) {
        let pa = t.replace(new RegExp(`^${this.paramTagPrefix}`, 'i'), ''); // Prefix removal
        let v = params[pa] ?? ''; // Extract the parameter value
        if (params?.FORMAT_PARAMS_FOR_JS === true) v = `{${pa}}`; // Override for template literal interpolation or template string substitution
        strng = strng.replace(new RegExp(t, 'g'), v); // Replacement
      } // for
    } // if 

    return strng;

  } // replaceParamTags

} // Tarazed

export default Tarazed;