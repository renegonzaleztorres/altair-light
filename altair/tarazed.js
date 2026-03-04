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
  
  constructor({ elemTagPrefix = '@@ELEM_', repeatTagPrefix = '@@REPEAT_', varTagPrefix = '@@VAR_', paramTagPrefix = '@@PARAM_', dataTagPrefix = '@@DATA_', appPath = '', readoutCallback = null } = {}) {

    // Error if appPath is missing or blank
    if (typeof appPath !== 'string' || appPath.trim() === '') {
      throw new Error(`Invalid "Tarazed appPath": expected a non-empty string.`);
    }

    this.elemTagPrefix = elemTagPrefix;
    this.repeatTagPrefix = repeatTagPrefix;
    this.varTagPrefix = varTagPrefix;
    this.paramTagPrefix = paramTagPrefix;
    this.dataTagPrefix = dataTagPrefix;
    this.appPath = appPath;
    this.readoutCallback = readoutCallback;

  }

  // escapeRegex : escape RegExp metacharacters in dynamic strings
  escapeRegex = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
      matches = strng.match(new RegExp(`${this.escapeRegex(this.elemTagPrefix)}[a-zA-Z0-9_.\\-\\/\\\\]*(?:;\\{.*?\\})?`, 'gi')); // Matches any alphanumeric chars., underscores, periods, forward slashes & backslashes that immediately follow the prefix, and optional ;{...}
      if (matches && matches.length > 0) {
        let uniqueMatches = new Set(matches);
        for (const t of uniqueMatches) {
          const separatorIndex = t.indexOf(';');
          let fp = t;
          let o = '{}';
          if (separatorIndex >= 0) {
            fp = t.slice(0, separatorIndex);
            o = t.slice(separatorIndex + 1);
          } // if
          let f = fp.replace(new RegExp(`^${this.escapeRegex(this.elemTagPrefix)}`, 'i'), ''); // Prefix removal
          f = path.join(this.appPath, f);
          try {
            let d = await fs.readFile(f, 'utf8'); // UTF-8: (8-bit Unicode Transformation Format)
            if (o) {
              try{
                let params = JSON.parse(o);
                d = this.replaceParamTags(d, params);
              } catch{}
            } // if
            const safeTag = this.escapeRegex(t);
            strng = strng.replace(new RegExp(safeTag, 'g'), () => d); // Replacement
          } 
          catch (err) {
            if (this.readoutCallback !== null)
              this.readoutCallback(`Reading file ${f} > ${err}`, 'Error');
            const safeTag = this.escapeRegex(t);
            strng = strng.replace(new RegExp(safeTag, 'g'), () => 'UNDEFINED'); // Replacement
          } // try
        } // for
      } // if
    }
    while (matches && matches.length > 0);

    return strng;

  } // replaceElemTags

  // stripRepeatTagPrefix : remove @@REPEAT_ from a token
  stripRepeatTagPrefix = (token) => {
    const repeatRegex = new RegExp(`^${this.escapeRegex(this.repeatTagPrefix)}`, 'i');
    if (repeatRegex.test(token)) {
      return token.replace(repeatRegex, '');
    }

    return token;
  } // stripRepeatTagPrefix

  // parseRepeatTag : parse @@REPEAT_ token into parts
  // Supported patterns:
  // - @@REPEAT_components/card/_card.html;data/content.json#cards
  // - @@REPEAT_components/card/_card.html;@@DATA_data/content.json#cards
  // - @@REPEAT_components/card/_card.html;data/content.json#cards?ci=true
  // - @@REPEAT_components/card/_card.html;data/content.json#cards?behavior=default&default=EMPTY
  // - @@REPEAT_components/card/_card.html;data/content.json#groups[0].items
  // - @@REPEAT_components/card/_card.html;data/content.json#cards;{"Title":"title","Url":"url","Index":"$index"}
  // - @@REPEAT_components/card/_card.html;data/content.json#cards;{"Name":"meta.name","Order":"$number"}
  parseRepeatTag = (tag) => {
    const token = String(tag ?? '');
    const body = this.stripRepeatTagPrefix(token);
    if (body.trim() === '') {
      return null;
    }

    const firstSeparatorIndex = body.indexOf(';');
    if (firstSeparatorIndex < 0) {
      return null;
    }

    const templatePath = body.slice(0, firstSeparatorIndex).trim();
    const rest = body.slice(firstSeparatorIndex + 1).trim();
    if (templatePath === '' || rest === '') {
      return null;
    }

    const secondSeparatorIndex = rest.indexOf(';');
    let dataSource = rest;
    let mapping = {};
    if (secondSeparatorIndex >= 0) {
      dataSource = rest.slice(0, secondSeparatorIndex).trim();
      const mappingRaw = rest.slice(secondSeparatorIndex + 1).trim();
      if (mappingRaw !== '') {
        mapping = JSON.parse(mappingRaw);
        if (mapping === null || typeof mapping !== 'object' || Array.isArray(mapping)) {
          return null;
        }
      }
    }

    return {
      templatePath,
      dataSource: dataSource.trim(),
      mapping,
    };
  } // parseRepeatTag

  // normalizeTemplateFilePath : normalize, validate and resolve template path
  normalizeTemplateFilePath = (rawTemplatePath) => {
    const relativePath = String(rawTemplatePath || '').replace(/\\/g, '/').trim();
    if (relativePath === '' || path.isAbsolute(relativePath)) {
      return null;
    }

    const resolvedPath = path.resolve(this.appPath, relativePath);
    const appRoot = path.resolve(this.appPath) + path.sep;
    if (!(resolvedPath + path.sep).startsWith(appRoot) && resolvedPath !== path.resolve(this.appPath)) {
      return null;
    }

    return resolvedPath;
  } // normalizeTemplateFilePath

  // asParamValue : shape value for @@PARAM_ replacement
  asParamValue = (value) => {
    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return '';
      }
    }
    return value;
  } // asParamValue

  // resolveEachSelector : resolve selector against one repeated item
  resolveEachSelector = ({ item, selector, index }) => {
    const s = String(selector ?? '').trim();
    if (s === '$index') {
      return { found: true, value: index };
    }
    if (s === '$number') {
      return { found: true, value: index + 1 };
    }

    return this.getByPath(item, s, { ci: false });
  } // resolveEachSelector

  // buildEachParams : derive params object for one repeated item
  buildEachParams = ({ item, index, mapping }) => {
    const params = {};
    const hasMapping = mapping && typeof mapping === 'object' && Object.keys(mapping).length > 0;

    if (hasMapping) {
      for (const [paramName, selector] of Object.entries(mapping)) {
        if (typeof selector !== 'string') {
          params[paramName] = this.asParamValue(selector);
          continue;
        }
        const resolved = this.resolveEachSelector({ item, selector, index });
        params[paramName] = this.asParamValue(resolved.found ? resolved.value : '');
      }
    } else if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      for (const [k, v] of Object.entries(item)) {
        params[k] = this.asParamValue(v);
      }
    } else {
      params.value = this.asParamValue(item);
    }

    if (params.index === undefined) { params.index = index; }
    if (params.number === undefined) { params.number = index + 1; }
    return params;
  } // buildEachParams

  // replaceRepeatTags : replace @@REPEAT_ tags by repeating an element for each item in a JSON array
  replaceRepeatTags = async (s) => {
    if (typeof s !== 'string') { return s; }

    let strng = s;
    const repeatPrefix = this.escapeRegex(this.repeatTagPrefix);
    const pattern = new RegExp(`${repeatPrefix}[a-zA-Z0-9_.\\-\\/\\\\]+;[^\\s"'<>;,)\\}]+(?:;\\{.*?\\})?`, 'gi');
    const matches = strng.match(pattern);
    if (!matches) {
      return strng;
    }

    const uniqueMatches = new Set(matches);
    const dataFileCache = new Map();
    const templateCache = new Map();

    for (const token of uniqueMatches) {
      let replacement = 'UNDEFINED';
      let modifiers = { behavior: 'strict', defaultValue: null };

      try {
        const parsedRepeat = this.parseRepeatTag(token);
        if (!parsedRepeat || parsedRepeat.templatePath === '' || parsedRepeat.dataSource === '') {
          replacement = 'UNDEFINED';
        } else {
          const dataToken = parsedRepeat.dataSource.toUpperCase().startsWith(this.dataTagPrefix.toUpperCase()) ? parsedRepeat.dataSource : `${this.dataTagPrefix}${parsedRepeat.dataSource}`;
          const parsedData = this.parseDataTag(dataToken);
          modifiers = this.parseDataModifiers(parsedData?.query || '');

          const normalizedDataPath = this.normalizeDataFilePath(parsedData?.filePath || '');
          const normalizedTemplatePath = this.normalizeTemplateFilePath(parsedRepeat.templatePath);
          if (!normalizedDataPath || !normalizedTemplatePath) {
            replacement = this.applyDataFallback({ behavior: modifiers.behavior, defaultValue: modifiers.defaultValue, token });
          } else {
            let jsonData;
            if (dataFileCache.has(normalizedDataPath)) {
              jsonData = dataFileCache.get(normalizedDataPath);
            } else {
              const fileContents = await fs.readFile(normalizedDataPath, 'utf8');
              jsonData = JSON.parse(fileContents);
              dataFileCache.set(normalizedDataPath, jsonData);
            }

            const lookedUp = this.getByPath(jsonData, parsedData?.selector || '', { ci: modifiers.ci });
            if (!lookedUp.found || !Array.isArray(lookedUp.value)) {
              replacement = this.applyDataFallback({ behavior: modifiers.behavior, defaultValue: modifiers.defaultValue, token });
            } else {
              let templateText;
              if (templateCache.has(normalizedTemplatePath)) {
                templateText = templateCache.get(normalizedTemplatePath);
              } else {
                const rawTemplate = await fs.readFile(normalizedTemplatePath, 'utf8');
                templateText = await this.replaceElemTags(rawTemplate);
                templateCache.set(normalizedTemplatePath, templateText);
              }

              let rendered = '';
              for (let i = 0; i < lookedUp.value.length; i += 1) {
                const params = this.buildEachParams({ item: lookedUp.value[i], index: i, mapping: parsedRepeat.mapping });
                rendered += this.replaceParamTags(templateText, params);
              }
              replacement = rendered;
            }
          }
        }
      } catch (err) {
        if (this.readoutCallback !== null) {
          this.readoutCallback(`Resolving repeat token ${token} > ${err}`, 'Error');
        }
        replacement = this.applyDataFallback({ behavior: modifiers.behavior, defaultValue: modifiers.defaultValue, token });
      }

      const safeTag = this.escapeRegex(token);
      strng = strng.replace(new RegExp(safeTag, 'g'), () => replacement);
    }

    return strng;
  } // replaceRepeatTags

  // parseDataTag : parse @@DATA_ token into parts
  // Supported patterns:
  // - @@DATA_data/file.json
  // - @@DATA_data/file.json#path.to.value
  // - @@DATA_data/file.json#path.to.value?ci=true&raw=true&default=foo&behavior=default
  parseDataTag = (tag) => {
    const token = String(tag ?? '');
    const body = token.replace(new RegExp(`^${this.escapeRegex(this.dataTagPrefix)}`, 'i'), '');
    if (body.trim() === '') {
      return null;
    }

    const hashIndex = body.indexOf('#');
    const queryIndex = body.indexOf('?');
    const hasSelector = hashIndex >= 0 && (queryIndex < 0 || hashIndex < queryIndex);

    let filePath = body;
    let selector = '';
    let query = '';

    if (hasSelector) {
      filePath = body.slice(0, hashIndex);
      const selectorAndQuery = body.slice(hashIndex + 1);
      const selectorQueryIndex = selectorAndQuery.indexOf('?');
      if (selectorQueryIndex >= 0) {
        selector = selectorAndQuery.slice(0, selectorQueryIndex);
        query = selectorAndQuery.slice(selectorQueryIndex + 1);
      } else {
        selector = selectorAndQuery;
      }
    } else if (queryIndex >= 0) {
      filePath = body.slice(0, queryIndex);
      query = body.slice(queryIndex + 1);
    }

    return {
      filePath: filePath.trim(),
      selector: selector.trim(),
      query: query.trim(),
    };
  } // parseDataTag

  // parseDataModifiers : parse query-string modifiers
  parseDataModifiers = (query) => {
    const params = new URLSearchParams(query || '');
    const getBoolean = (k, d = false) => {
      const v = params.get(k);
      if (v === null) {
        return d;
      }
      return String(v).toLowerCase() === 'true';
    };

    const behavior = String(params.get('behavior') || 'strict').toLowerCase();
    return {
      ci: getBoolean('ci', false),
      raw: getBoolean('raw', false),
      defaultValue: params.get('default'),
      behavior,
    };
  } // parseDataModifiers

  // normalizeDataFilePath : normalize, validate and resolve data file path
  normalizeDataFilePath = (rawFilePath) => {
    const relativePath = String(rawFilePath || '').replace(/\\/g, '/').trim();
    if (relativePath === '' || path.isAbsolute(relativePath)) {
      return null;
    }

    const resolvedPath = path.resolve(this.appPath, relativePath);
    const appRoot = path.resolve(this.appPath) + path.sep;
    if (!(resolvedPath + path.sep).startsWith(appRoot) && resolvedPath !== path.resolve(this.appPath)) {
      return null;
    }

    if (path.extname(resolvedPath).toLowerCase() !== '.json') {
      return null;
    }

    return resolvedPath;
  } // normalizeDataFilePath

  // getByPath : retrieve nested object value from dot/bracket path
  getByPath = (obj, selector, { ci = false } = {}) => {
    if (selector === '' || selector === '$') {
      return { found: true, value: obj };
    }

    const parts = [];
    const regex = /([^[.\]]+)|\[(\d+)\]/g;
    let match;
    while ((match = regex.exec(selector)) !== null) {
      if (match[1] !== undefined) {
        parts.push({ type: 'key', value: match[1] });
      } else if (match[2] !== undefined) {
        parts.push({ type: 'index', value: Number(match[2]) });
      }
    }

    if (parts.length === 0) {
      return { found: false, value: undefined };
    }

    let current = obj;
    for (const part of parts) {
      if (part.type === 'index') {
        if (!Array.isArray(current) || part.value < 0 || part.value >= current.length) {
          return { found: false, value: undefined };
        }
        current = current[part.value];
        continue;
      }

      if (current === null || typeof current !== 'object' || Array.isArray(current)) {
        return { found: false, value: undefined };
      }

      if (!ci) {
        if (!Object.prototype.hasOwnProperty.call(current, part.value)) {
          return { found: false, value: undefined };
        }
        current = current[part.value];
        continue;
      }

      const lowerKey = String(part.value).toLowerCase();
      const matchedKey = Object.keys(current).find((k) => k.toLowerCase() === lowerKey);
      if (matchedKey === undefined) {
        return { found: false, value: undefined };
      }
      current = current[matchedKey];
    }

    return { found: true, value: current };
  } // getByPath

  // applyDataFallback : resolve missing/invalid lookups according to behavior mode
  applyDataFallback = ({ behavior, defaultValue, token }) => {
    switch (behavior) {
      case 'empty':
        return '';
      case 'null':
        return 'null';
      case 'default':
        return defaultValue ?? 'UNDEFINED';
      case 'pass':
        return token;
      case 'strict':
      default:
        return 'UNDEFINED';
    }
  } // applyDataFallback

  // resolveDataValue : shape final value for replacement
  resolveDataValue = ({ value, raw, behavior, defaultValue, token }) => {
    if (raw) {
      try {
        return JSON.stringify(value);
      } catch (err) {
        return this.applyDataFallback({ behavior, defaultValue, token });
      }
    }

    if (value !== null && typeof value === 'object') {
      return this.applyDataFallback({ behavior, defaultValue, token });
    }

    return value;
  } // resolveDataValue

  // replaceDataTags : replace @@DATA_ tags with values from JSON files
  replaceDataTags = async (s) => {
    if (typeof s !== 'string') { return s; }

    let strng = s;
    const pattern = new RegExp(`${this.escapeRegex(this.dataTagPrefix)}[^\\s"'<>;,)\\}]+`, 'gi');
    const matches = strng.match(pattern);
    if (!matches) {
      return strng;
    }

    const uniqueMatches = new Set(matches);
    const fileCache = new Map();

    for (const token of uniqueMatches) {
      let replacement = 'UNDEFINED';

      try {
        const parsed = this.parseDataTag(token);
        if (!parsed || parsed.filePath === '') {
          replacement = 'UNDEFINED';
        } else {
          const modifiers = this.parseDataModifiers(parsed.query);
          const normalizedPath = this.normalizeDataFilePath(parsed.filePath);
          if (!normalizedPath) {
            replacement = this.applyDataFallback({ behavior: modifiers.behavior, defaultValue: modifiers.defaultValue, token });
          } else {
            let jsonData;
            if (fileCache.has(normalizedPath)) {
              jsonData = fileCache.get(normalizedPath);
            } else {
              const fileContents = await fs.readFile(normalizedPath, 'utf8');
              jsonData = JSON.parse(fileContents);
              fileCache.set(normalizedPath, jsonData);
            }

            const lookedUp = this.getByPath(jsonData, parsed.selector, { ci: modifiers.ci });
            if (!lookedUp.found) {
              replacement = this.applyDataFallback({ behavior: modifiers.behavior, defaultValue: modifiers.defaultValue, token });
            } else {
              replacement = this.resolveDataValue({
                value: lookedUp.value,
                raw: modifiers.raw,
                behavior: modifiers.behavior,
                defaultValue: modifiers.defaultValue,
                token
              });
            }
          }
        }
      } catch (err) {
        if (this.readoutCallback !== null) {
          this.readoutCallback(`Resolving data token ${token} > ${err}`, 'Error');
        }
        const parsed = this.parseDataTag(token);
        const modifiers = this.parseDataModifiers(parsed?.query || '');
        replacement = this.applyDataFallback({ behavior: modifiers.behavior, defaultValue: modifiers.defaultValue, token });
      }

      const safeTag = this.escapeRegex(token);
      strng = strng.replace(new RegExp(safeTag, 'g'), () => replacement);
    }

    return strng;
  } // replaceDataTags

  // replaceVarTags : replace variable tags in a string with corresponding static|dynamic values (use any case for the tags but the variables being matched will be in lowercase)
  // Example(s): @@VAR_YEAR @@VAR_Year @@VAR_year @@VAR_Year-Month @@VAR_Year_Month @@VAR_YearMonth
  // - @@VAR_ is the prefix
  // - YEAR is the variable 
  // (string) s
  // (object) vD : var definitions - all keys should be in lowercase. Underscores and hyphens are allowed
  replaceVarTags = (s, vD = {}) => {
    if (typeof s !== 'string'){ return s; }
    let strng = s;
    let matches = strng.match(new RegExp(`${this.escapeRegex(this.varTagPrefix)}[\\w-]+`, 'gi')); // Matches ONLY alphanumeric chars, underscores and hyphens that immediately follow the prefix
    if (matches) {
      let uniqueMatches = new Set(matches);
      for (const t of uniqueMatches) {
        let k = t.replace(new RegExp(`^${this.escapeRegex(this.varTagPrefix)}`, 'i'), '').toLowerCase(); // Prefix removal
        let v = vD[k] ?? 'UNDEFINED';
        let safeTag = this.escapeRegex(t); // Escape special chars in tag for use in RegExp
        strng = strng.replace(new RegExp(safeTag, 'g'), () => v); // Replacement
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
    let matches = strng.match(new RegExp(`${this.escapeRegex(this.paramTagPrefix)}[a-zA-Z0-9_-]+`, 'gi')); // Matches ONLY alphanumeric chars., underscores and dashes that immediately follow the prefix
    if (matches) {
      let uniqueMatches = new Set(matches);
      for (const t of uniqueMatches) {
        let pa = t.replace(new RegExp(`^${this.escapeRegex(this.paramTagPrefix)}`, 'i'), ''); // Prefix removal
        let v = params[pa] ?? ''; // Extract the parameter value
        if (params?.FORMAT_PARAMS_FOR_JS === true) v = `{${pa}}`; // Override for template literal interpolation or template string substitution
        const safeTag = this.escapeRegex(t);
        strng = strng.replace(new RegExp(safeTag, 'g'), () => v); // Replacement
      } // for
    } // if 

    return strng;

  } // replaceParamTags

} // Tarazed

export default Tarazed;
