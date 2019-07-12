(() => {
	"use strict";

/// Function returned by various methods when things are not found.
/// This allows callers to either use it blindly or check if it not_found
var not_found = () => null;

// This thing is turning into a god class...
class LocalizeMe {
	constructor() {
		this.added_locales = {};
		// If the index is a native, then it is mapped to null.
		this.locales_by_index = {};
		this.locale_count = 0;

		this.current_locale = null;
		this.from_locale = null;

		this.map_file = null;
		this.url_cache = {};

		// no defer ?
		this.language_known = new Promise((resolve) => {
			this.language_known_resolve = resolve;
		});
		this.language_known.then((locale) => {
			console.log("final locale:", locale);
		});
	}
	/*
	 * Locale name must only contain the language and country,
	 * options can contains:
	 * - everything from LANG_DETAILS
	 * - "from_locale" indicate from which basic locale this was translated
	 *		   from.  Used for 'orig' check, decryption or langfile
	 *		   patching.
	 * - "map_file" must be either an URL to a JSON object or a function
	 *		returning a promise resolving to a JSON object or
	 *		function.  The function/JSON object must map an asset
	 *		file path to a translation pack URL or function.
	 *		these URL/function must return a JSON or function
	 *		translations packs must map dict_paths of
	 *		langLabels to their translation as string or
	 *		as translation objects to use.
	 *		It is also possible to return an entire JSON object
	 *		for lang files.
	 * - "url_prefix" is an optional string, which is prepended to all
	 *		       URL found in a map file.  Using something based
	 *		       on document.currentScript.src allows your mod
	 *		       to be relocatable. It should most of the time
	 *		       end with '/'.
	 * - "missing_cb" an optional function to call when a string has no
	 *		  translation. parameters are a lang label or string
	 *		  and the dict path.
	 * - "language" a langLabel indicating the name of the language to be
	 *		used in the language options. If a language is missing
	 *		then language[locale] will be used by default.  langUid
	 *		is ignored by this function.
	 * - "text_filter" an optional function called for each translated
	 *		   string that should return the string to use.  Can be
	 *		   used to change the encoding of the text to match the
	 *		   font or apply similar transformations.  Called with
	 *		   (text, translation object)
	 * - "patch_font" an optional function called for each loaded font.
	 *		  Can be used to change the encoding of displayed text,
	 *		  add missing characters or more.  Called with
	 *		  (loaded_image (not scaled), context), where context
	 *		  is unique per multifont and contains the two methods:
	 *		  get_char_pos(c) -> { x, y, width, height } to get
	 *		  the position of a char in loaded_image and
	 *		  set_char_pos(c, { x, y, width, height }) to change it.
	 *		  This function can not block, use pre_patch_font to
	 *		  perform blocking operations (like, loading images)
	 *
	 * - "pre_patch_font" an optional function that is called before the
	 *		      first call to patch_font.  Unlike patch_font,
	 *		      this one may return a promise and will be called
	 *		      once per font.  Takes a context containing
	 *		      "char_height" (height of font),
	 *		      "size_index" (as used by the game) and
	 *		      "base_image" (the base image of a multifont).
	 *		      This context is carried out to patch_font, so you
	 *		      may store stuff in there.
	 *
	 * - "number_locale" If set, then number patching is enabled, and this
	 *		     locale string will be used as the first parameter
	 *		     of Number.prototype.toLocaleString.  This should
	 *		     cover most number formatting needs.  Note that it
	 *		     formats the '%' unit with the 'percent' style of
	 *		     toLocaleString() but only suffix the other units.
	 *
	 * - "format_number" If set, then number patching is enabled and this
	 *		     function will be called with 4 parameters, and
	 *		     should return a formatted number as a string.
	 *		     (number, precision, suffix, template)
	 *		     'number' is the Number to format
	 *		     'precision' indicates how much fractional digits
	 *		                 must be displayed (as in toFixed())
	 *		     'units' is either empty, or contains an unit.
	 *		             currently, only '%', 'm' and 'km' are used.
	 *		             it should be suffixed or to the number
	 *		     'template' is passed only if 'number_locale' is
	 *		                defined: this is the number formatted
	 *		                by toLocaleString as if only
	 *		                'number_locale' was defined.  It is
	 *		                this possible to reuse this formatted
	 *		                number instead of recoding everything
	 *		                from scratch.
	 *
	 * This function should be called in postload. This object will be
	 * available if you depend on this mod.
	 */
	add_locale(name, options) {
		if (name in this.added_locales) {
			console.error("Language " + name + " added twice");
			return;
		}
		this.added_locales[name] = options
	}

	/*
	 * Initialize all locales, assigning them ids for the game's
	 * language indexes of doom.
	 */
	initialize_locales(game_lang_detail, languages_indexes) {
		var count = 0;
		for (var locale in game_lang_detail) {
			if (this.added_locales[locale]) {
				console.warn("Language " + name
					     + " already there");
				delete this.added_locales[locale];
			}
			count++;
		}
		for (var lang in languages_indexes)
			this.locales_by_index[languages_indexes[lang]] = null;

		var added = Object.keys(this.added_locales);
		added.sort();
		added.forEach(locale => {
			var options = this.added_locales[locale];
			var index = count++;
			options.localizeme_global_index = index;
			game_lang_detail[locale] = options;
			languages_indexes["LOCALIZEME"+locale] = index;
			this.locales_by_index[index] = locale;
			this.locale_count++;
		});
	}

	// Get a index for a given (added) locale name, or null if not found.
	get_index_for_locale(locale) {
		var options = this.added_locales[locale];
		if (!options)
			return null;
		return options.localizeme_global_index;
	}

	/**
	 * @brief Get a locale name given an language index.
	 *
	 * If this one of our locale, then return its locale, as it was
	 * passed to add_locale().
	 * If this is a game-native locale, then return null
	 * else, return undefined.
	 */
	get_locale_by_index(index) {
		return this.locales_by_index[index];
	}

	// Fetch the thing at url and return its xhr responseText.
	fetch_stuff(url) {
		return new Promise((resolve, reject) => {
			var req = new XMLHttpRequest();
			req.open('GET', url, true);
			req.onerror = reject;
			req.onreadystatechange = () => {
				if (req.readyState !== req.DONE
				    || req.status !== 200)
					return; // reject ?
				resolve(req.responseText);
			};
			req.send();
		});
	}
	/*
	 * If thing is a string, treat it as an URL and fetch its JSON,
	 * else assume it is a function and call it without any argument.
	 * The function may return a promise.
	 *
	 * JSON objects refered by their URL are cached.
	 */
	async fetch_or_call(thing) {
		if (thing.constructor !== String) {
			var ret = await thing();
			return ret;
		}
		var ret = this.url_cache[thing];
		if (!ret) {
			ret = this.fetch_stuff(thing);
			ret = ret.then(json => JSON.parse(json));
			this.url_cache[thing] = ret;
		}
		return ret;
	}

	/*
	 * Get a map file for the given current locale.
	 *
	 * This returns a map_file function that maps assets path relative to
	 * assets/data/ into a translation pack url, or a function
	 * returning a json or function.
	 *
	 * the map_file function is cached for later use.
	 */
	async get_map_file() {
		if (this.current_locale === null)
			await this.language_known;
		if (this.map_file)
			// may return a promise not resolved yet.
			return this.map_file;

		var localedef = this.added_locales[this.current_locale];
		var url_or_func = localedef.map_file;

		this.map_file = this.fetch_or_call(url_or_func)
		    .then(result => {
			var map_func;
			if (typeof result !== "function") {
				var prefix = localedef.url_prefix || '';
				map_func = (url_to_patch) => {
					var ret = result[url_to_patch];
					if (ret)
						ret = prefix + ret;
					return ret || null;
				};
			} else
				map_func = result;
			this.map_file = map_func;
			return map_func;
		    });

		// it's not loaded yet, but the promise will eventually resolve
		this.from_locale = localedef.from_locale || 'en_US';
		return this.map_file;
	}
	/*
	 * Get a translation pack for the given path and json and locale.
	 *
	 * The path must be relative to assets/data.
	 *
	 * This returns a function mapping a dict path to a translation result.
	 * a dict path is basically a cursor to a element of a json file.
	 * e.g. if file hello/world.json contains {"foo":["bar"]},
	 * then dict path "hello/world.json/foo/0" points to "bar".
	 *
	 * a translation result is either a translated string or an object with
	 * these optional fields:
	 *
	 * - orig: the original text from from_locale, if the loaded file
	 *	    does not match this string, then the translation is likely
	 *	    stale and should not be used
	 * - text: the translated text to use.
	 * - ciphertext: the translated text, encrypted with AES-CBC with
	 *		 the key equal to MD5(original text). This idiotic
	 *		 scheme is mainly here for copyright reasons.
	 * - mac: a HMAC-MD5 of the translated text with key MD5(original text)
	 *	  for detecting stale translations and not returning garbage.
	 *
	 * If a translation result is unknown, null or undefined is returned.
	 */
	async get_transpack(json_path, json) {
		var map_file = await this.get_map_file();
		var url_or_func = map_file(json_path, json);
		var result;
		if (url_or_func) {
			result = await this.fetch_or_call(url_or_func);
			if (typeof result !== "function") {
				var saveme = result;
				result = dict_path => saveme[dict_path];
			}
		} else
			result = not_found;
		return result;
	}

	/**
	 * If 'json' is an Object, call cb(value, key) for each key.
	 * If 'json' is an Array, call cb(value, index) for each element in it.
	 * Will ignore anything else.
	 */
	walk_json(json, cb) {
		if (json === null)
			return;
		if (json.constructor === Array)
			json.forEach(cb);
		if (json.constructor === Object)
			for (var index in json)
				if (json.hasOwnProperty(index))
					cb(json[index], index);
	}

	/**
	 * Iterate over all lang labels found in the object and call the
	 * callback with (lang_label, dict_path).
	 * It should be possible to modify the lang_label inside the callback.
	 */
	for_each_langlabels(json, dict_path_prefix, callback) {
		if (json !== null && json[this.from_locale])
			return callback(json, dict_path_prefix);
		this.walk_json(json, (value, index) => {
			var sub = dict_path_prefix + '/' + index;
			this.for_each_langlabels(value, sub, callback);
		});
	}

	/**
	 * Get the HMAC of the given string or CryptoJS.lib.WordArray.
	 *
	 * key must be a CryptoJS.lib.WordArray
	 *
	 * Returns a CryptoJS.lib.WordArray with the hmacmd5
	 */
	hmacmd5(message, key) {
		/// The loaded CryptoJS has a CryptoJS.HmacMD5 symbol ... that
		/// does not work. It tries to reference CryptoJS.HMAC, which
		/// doesn't exist. Hopefully, HMAC isn't complicated to code.
		var outer = key.clone();
		const to_words = x => CryptoJS.lib.WordArray.create(x);
		// pad 16 bytes to 64 -> 48 bytes, which is 12 u32
		outer.concat(to_words(Array.from({length: 12}, () => 0)));
		var ip = outer.words
			      .map((v,i,a) => 0x6a6a6a6a ^ (a[i]^=0x5c5c5c5c));
		outer.concat(CryptoJS.MD5(to_words(ip).concat(message)));
		return CryptoJS.MD5(outer);
	}

	/**
	 * Given a translation result, get the translation of the given
	 * string or lang label.
	 *
	 * This function does not support lang labels mappings to array or
	 * objects.  Thanksfully, these appear to be currently unused.
	 *
	 * Returns a string, or null if the translation is unknown.
	 */
	get_translated_string(trans_result, lang_label_or_string) {
		if (trans_result === null || trans_result === undefined)
			return null;
		if (trans_result.constructor === String)
			return trans_result;
		var orig = (lang_label_or_string[this.from_locale]
			    || lang_label_or_string);
		if (trans_result.orig && orig && trans_result.orig !== orig)
			// original text has changed, translation is stale.
			return null;
		if (trans_result.text)
			return trans_result.text;
		// the loaded CryptoJS only supports AES CBC with Pkcs7 and
		// MD5... This should be more than enough for the "security"
		// that we need: requiring the game files to get the
		// translation.
		if (!trans_result.ciphertext)
			return null;
		var ciphertext
			= CryptoJS.enc.Base64.parse(trans_result.ciphertext);
		var key = CryptoJS.MD5(orig);
		var param = CryptoJS.lib.CipherParams.create({ ciphertext,
							       iv:key})
		var text = CryptoJS.AES.decrypt(param, key,
						{ mode: CryptoJS.mode.CBC,
						  padding: CryptoJS.pad.Pkcs7,
						  iv: key}
		);
		if (trans_result.mac) {
			// if i don't do this, then calculating the md5 of it
			// fails.
			text.clamp();
			// wait, CryptoJS.HmacMD5 does not work ? Crap.
			// var correct_mac = CryptoJS.HmacMD5(text, key);
			var correct_mac = this.hmacmd5(text, key);

			var mac = CryptoJS.enc.Base64.stringify(correct_mac);
			if (trans_result.mac !== mac)
				// stale translation
				return null;
		}
		return CryptoJS.enc.Utf8.stringify(text);
	}

	/**
	 * Given a translation result, get the translation of the given
	 * string or lang label.
	 *
	 * Always returns a string, unlike get_translated_string().
	 *
	 * If the translation is unknown, then call the missing callback
	 * or return the original text prefixed by --.
	 */
	get_text_to_display(trans_result, lang_label_or_string, dict_path) {
		var ret = this.get_translated_string(trans_result,
						     lang_label_or_string);
		var localedef = this.added_locales[this.current_locale];
		if (ret !== null) {
			if (localedef.text_filter)
				ret = localedef.text_filter(ret, trans_result);
			return ret;
		}

		var missing = localedef.missing_cb;
		if (missing)
			ret = missing(lang_label_or_string, dict_path);
		if (!ret)
			ret = "--" + (lang_label_or_string[this.from_locale]
				      || lang_label_or_string);
		return ret;
	}

	/*
	 * Patch the lang labels in the json object loaded at path
	 * for the given current locale.
	 *
	 * Resolves to the json parameter, possibly modified.
	 */
	async patch_langlabels(path, json) {
		var locale = this.added_locales[this.current_locale];
		if (!locale)
			return json;

		var pack = await this.get_transpack(path, json)
				     .catch(() => not_found);

		this.for_each_langlabels(json, path,
					 (lang_label, dict_path) => {
			var trans = pack(dict_path, lang_label);
			var text = this.get_text_to_display(trans, lang_label);
			lang_label[this.current_locale] = text;
		});
		return json;
	}

	/*
	 * Return a pack suitable for patching langfiles.
	 *
	 * This is like get_transpack(), except this also handles if the
	 * translation pack is a full langfile replacement.
	 */
	async get_langfile_pack(path, json) {
		var pack = await this.get_transpack(path, json)
				     .catch((a) => {
					     console.warn("failed path", path,
							  a);
					     return not_found;
				     });
		if (pack("DOCTYPE") !== "STATIC-LANG-FILE")
			return pack; // normal pack.

		// it's not really a pack ... more like a json langfile that
		// we parsed like a pack, but we can recover.
		if (pack("feature") !== json["feature"]) {
			console.error("mismatch between lang file feature :",
				      pack("feature"), "!=", json["feature"]);
			return not_found;
		}
		var labels = pack("labels");
		return ((prefix, dict_path) => {
			if (!dict_path.startsWith(prefix)) {
				console.error("invalid dict path for langfile",
					      dict_path);
				return null;
			}
			var cursor = labels;
			var path = dict_path.substr(prefix.length).split("/");
			path.forEach(component => {
				cursor = cursor && cursor[component];
			});
			if (!cursor && cursor !== "")
				return null;
			return cursor;
		}).bind(null, path + "/labels/");
	}

	/*
	 * Assume the json object is a langfile residing at path
	 * and patch every value in it using the given pack.
	 *
	 * Resolves to the json parameter after modifying it.
	 */
	patch_langfile_from_pack(json, path, pack) {
		var recurse = (json, dict_path_prefix) => {
			this.walk_json(json, (value, index) => {
				var dict_path = dict_path_prefix + "/" + index;
				if (value.constructor !== String)
					return recurse(value, dict_path);
				var trans = pack(dict_path, value);
				trans = this.get_text_to_display(trans, value);
				json[index] = trans;
				// we are not allowing array to be extended
				// but that should rarely happen anyway.
				// it could be done later if required.
			});
		};
		recurse(json.labels, path + '/labels');
	}

	/*
	 * Patch the gui language list with our new locales.
	 *
	 * This should be used to patch the json object for the
	 * lang/sc/gui.*.json files, since the game will expect the language id
	 * to exist in the language array.  This allows those locales to be
	 * selected in the language settings.
	 */
	patch_language_list(gui_langfile_json) {
		var array = gui_langfile_json.labels.options.language.group;
		if (array.constructor !== Array) {
			console.error("Could not patch language array",
				      "game will likely crash !");
			return array;
		}
		for (var patched = 0; patched < this.locale_count; ++patched) {
			var locale = this.locales_by_index[array.length];
			if (!locale) {
				console.error("language array out of sync ?",
					      "patched ", patched, " out of ",
					      this.locale_count, " size is ",
					      array.length);
				array.push("ERROR");
				continue;
			}
			var lang_name = this.added_locales[locale].language;
			array.push(lang_name[this.current_locale]
				   || lang_name[locale]
				   || "ERROR NO LANGUAGE");
		}
	}

	/*
	 * Patch the given langfile loaded in json.
	 *
	 * path should be realive to assets/data/.
	 *
	 * If path is not found, the alternate path is tried next.
	 *
	 * Resolves to a modified json object.
	 */
	async patch_langfile(path, json, alt_path) {

		if (this.added_locales[this.current_locale]) {
			var pack = await this.get_langfile_pack(path, json);
			if (pack === not_found && alt_path) {
				pack = await this.get_langfile_pack(alt_path,
								    json);
				path = alt_path;
			}
			this.patch_langfile_from_pack(json, path, pack);
		}
		// patch the language list after patching the langfile,
		// otherwise, the added languages will be considered
		// as missing text.
		if (path.startsWith("lang/sc/gui."))
			this.patch_language_list(json);
		return json;
	}

	/*
	 * Change the given url so it resolves to a file that exists.
	 *
	 * This should be used for url that are constructed using the added
	 * locales, since these url points to files that do not exist.
	 *
	 * This function will change the url so it points to the locale's
	 * from_locale, so that we can patch it.
	 *
	 * Returns a possibly modified url.
	 */
	get_replacement_url(url) {
		if (this.current_locale === null)
			console.error("need to patch url without locale set");
		var localedef = this.added_locales[this.current_locale];

		if (!localedef)
			return url;

		var new_url = url.replace(this.current_locale,
					  localedef.from_locale);
		if (new_url === url)
			console.warn("Cannot find current locale in url", url);
		return new_url;
	}

	/// Resolves to the final language once it is known for sure.
	wait_for_language_known() {
		return this.language_known;
	}
	/// Set the actual locale chosen by the game.
	/// It should not change until the game restarts.
	set_actual_locale(locale) {
		this.current_locale = locale;
		this.language_known_resolve(locale);
	}


	// Return the current locale definition for the current locale.
	// If the actual is a native locale, then return null.
	// Caller should arrange for the final locale to be known first,
	// by e.g. awaiting wait_for_language_known().
	get_current_localedef() {
		return this.added_locales[this.current_locale];
	}
}
window.localizeMe = new LocalizeMe();

/*
 * Patches a multifont.
 *
 * This class is typically instanciated once per multifont to patch.
 */
class FontPatcher {
	constructor() {
		this.metrics_loaded_promise = new Promise((resolve) => {
			this.resolve_metrics_loaded = resolve;
		});
		this.context = null;
	}

	/*
	 * Call the pre_patch_hook then wait for it to complete.
	 */
	async prepare_patch(multifont) {
		await window.localizeMe.wait_for_language_known();
		this.context = { char_height: multifont.charHeight,
				 size_index: multifont.sizeIndex,
				 base_image: multifont.data
			       };
		var localedef = window.localizeMe.get_current_localedef();
		if (localedef && localedef.pre_patch_font)
			await localedef.pre_patch_font(this.context);
	}

	/*
	 * Fetch metrics then unblock all calls waiting for metrics to be
	 * available.
	 */
	metrics_loaded(multifont) {
		this.context.get_char_pos = ((c) => {
			var index = c.charCodeAt(0);
			index -= multifont.firstChar;
			// don't ask about the +1.
			var width = multifont.widthMap[index] + 1;
			var height = multifont.charHeight;
			var x = multifont.indicesX[index];
			var y = multifont.indicesY[index];
			return { x, y, width, height };
		}).bind(multifont);
		this.context.set_char_pos = ((c, rect) => {
			var index = c.charCodeAt(0);
			index -= multifont.firstChar;
			multifont.indicesX[index] = rect.x;
			multifont.indicesY[index] = rect.y;
			multifont.widthMap[index] = rect.width - 1;
			if (rect.height != multifont.charHeight)
				console.warn("bad height for",
					     c);
		}).bind(multifont);

		this.resolve_metrics_loaded();
	}

	/*
	 * Wait for the metrics to be available, then patch the given image.
	 *
	 * Resolves to a patched canvas/image whatever.
	 */
	async patch_image_async(image) {
		await this.metrics_loaded_promise;
		return this.patch_image_sync(image);
	}

	/*
	 * Patch the image synchronously.
	 */
	patch_image_sync(image) {
		var localedef = window.localizeMe.get_current_localedef();
		if (!localedef || !localedef.patch_font)
			return image;
		var ret = localedef.patch_font(image, this.context);
		if (!ret) {
			console.warn("patch_font() returned nothing");
			ret = image;
		}
		return ret;
	}

}

class NumberFormatter {
	constructor(loc_manager) {
		// this may stay null if we don't need to patch anything.
		this.localedef = null;

		loc_manager.wait_for_language_known().then(() => {
			var localedef = loc_manager.get_current_localedef();
			if (!localedef)
				return; // native locale, don't do anything.
			if (localedef.format_number
			    || localedef.number_locale) {
				// we sometimes need to unparse numbers, so
				// we need to expect them in en_US locale.
				// (i don't know how the de_DE locale works
				//  with fractional numbers).
				delete localedef.commaDigits;
				this.localedef = localedef;
			}
		});
	}
	// Assume that localedef.number_locale exists and format with it.
	format_number_default(number, frac_precision, unit) {
		var locale = this.localedef.number_locale;
		var options = {
			minimumFractionDigits: frac_precision,
			maximumFractionDigits: frac_precision
		};

		var suffix = '';
		if (unit === '%') {
			number /= 100;
			options.style = "percent";
		} else if (unit)
			suffix = unit;

		return number.toLocaleString(locale, options) + suffix;
	}
	// this function will crash if we shouldn't patch stuff.
	//
	// so don't call it when you don't need to.
	format_number(number, frac_precision, unit) {
		frac_precision = frac_precision || 0;
		unit = unit || null;
		number = Number(number);
		var ret = null;
		if (this.localedef.number_locale)
			ret = this.format_number_default(number,
							 frac_precision,
							 unit);

		if (this.localedef.format_number)
			ret = this.localedef.format_number(number,
							   frac_precision,
							   unit,
							   ret);
		return ret;
	}

	// Parse a number that had gone through the game formatter, based on
	// that regex o̶f̶ ̶d̶o̶o̶m̶ of stack overflow.
	unformat_en_us_number(number_str) {
		return Number(number_str.replace(/,/g, '', number_str));
	}

	hook_var_access() {
		var formatter = this;
		var find_number = splitted => {
			if (splitted[0] !== "misc")
				return null;
			if (splitted[1] === "localNum")
				return splitted[2];
			if (splitted[1] === "localNumTempVar")
				return ig.vars.get("tmp." + splitted[2]);
			return null;
		};
		var patched_on_var_access = function(varname, splitted) {
			if (formatter.localedef) {
				var number = find_number(splitted);
				if (number !== null)
					return formatter.format_number(number);
			}
			return this.parent(varname, splitted);
		};
		ig.module("localizeme_menu_model_numerics")
		  .requires("game.feature.menu.menu-model").defines(() => {
			sc.MenuModel.inject({
				onVarAccess: patched_on_var_access
			});
		});
	}
	hook_meters_statistics () {
		var format_meters = () => {
			if (this.localedef === null)
				return null; // native number formatting
			var steps = sc.stats.getMap("player", "steps") || 0;
			// 1.632 m per step ? that's a pretty big step.
			var meters = steps * 1.632;
			if (meters < 1000)
				return this.format_number(meters, 0, "m");
			return this.format_number(meters / 1000, 2, "km");
		};

		ig.module("localizeme_reimplement_steps")
		  .requires("game.feature.menu.gui.stats.stats-gui-builds")
		  .defines(() => {
			var general = sc.STATS_BUILD[sc.STATS_CATEGORY.GENERAL];
			// This one uses suffix to add fractional parts, sigh.
			general.meters.localize_me_format = format_meters;
		});

	}
	hook_statistics() {
		// remaining:
		// sc.StatPercentNumber
		// sc.NumberGui (big one)
		var formatter = this;

		var patched_keyvalue_init = function(a, data, c) {
			this.parent(a, data, c);
			if (formatter.localedef === null)
				return;

			if (data.asNumber) // that uses sc.NumberGui.
				return;

			if (data.localize_me_format) {
				var v = data.localize_me_format();
				if (v)
					this.valueGui.setText(v);
				return;
			}

			if (data.postfix)
				// We can't handle that. Fortunately, only one
				// statistics uses this, and its formatting is
				// completely broken anyway, so we're redoing
				// it with localize_me_format above.
				return;

			var number = this.valueGui.text;
			number = formatter.unformat_en_us_number(number);
			number = formatter.format_number(number);
			this.valueGui.setText(number);
		};
		var patched_keyvalue_set = function(num, data, suffix) {
			if (formatter.localedef === null)
				return this.parent(a, data, c);
			var text = data ? formatter.format_number(num) : num;
			this.valueGui.setText(text + suffix ? suffix : '');
		};

		var patched_keyvaluepercent_init = function(a, data, c) {
			this.parent(a, data, c);
			if (formatter.localedef === null)
				return;
			var text = this.numberGui.text;
			var index = text.indexOf('\\');
			var number = text.slice(0, index);
			number = formatter.unformat_en_us_number(number);
			number = formatter.format_number(number);
			this.numberGui.setText(number + text.slice(index));
		};

		ig.module("localizeme_stat_type_numerics")
		  .requires("game.feature.menu.gui.stats.stats-types")
		  .defines(() => {
			sc.STATS_ENTRY_TYPE.KeyValue.inject({
				init: patched_keyvalue_init,
				setValue: patched_keyvalue_set
			});
			sc.STATS_ENTRY_TYPE.KeyValuePercent.inject({
				init: patched_keyvaluepercent_init
			});
			// sc.STATS_ENTRY_TYPE.KeyCurMax also uses the dreaded
			// formatter, but it only formats integers between
			// 0 and something like 125, so is that really needed ?
		});

	}

	hook_into_game() {
		this.hook_var_access();
		this.hook_statistics();
		this.hook_meters_statistics();
	}
}

{
	var loc_me = window.localizeMe;

	// ig.LANG_DETAILS defined in game.config
	// sc.LANGUAGE_ICON_MAPPING need an update if we want flags one day.
	// sc.LANGUAGE defined in game.feature.model.options-model
	ig.module("localize_put_locales").requires(
		"game.config",
		"game.feature.model.options-model"
	).defines(function() {
		loc_me.initialize_locales(window.ig.LANG_DETAILS,
					  window.sc.LANGUAGE);
	});

	/// Patch the hidden struct defining the native locale -> index mapping.
	ig.module("localize_patch_up_option_model").requires(
		"game.feature.model.options-model"
	).defines(function() {
		var patched_check_settings = function(setting) {
			if (setting !== "language")
				return this.parent(setting);

			// If init() didn't find the language, then
			// this.values["language"] will not exist. Fill it.
			if (!this.values.hasOwnProperty("language")) {
				var locale = ig.currentLang;
				var index = loc_me.get_index_for_locale(locale);
				if (index == null)
					index = 0;
				this.values.language = index;
				console.log("Found missing locale " + locale);
				console.log("Set index to " + index);
			}
			var locale = loc_me.get_locale_by_index(this.values
								    .language);

			// Now resume normal processing, which is to actually
			// set the variable.
			if (!locale)
				// native locale, we don't have access to
				// the mapping...
				return this.parent(setting);

			localStorage.setItem("IG_LANG", locale);
			console.log("Locale set to " + locale
				    + " in localStorage");

		};
		var patch_loaded_globals = function(globals) {
			var id = loc_me.get_index_for_locale(ig.currentLang);
			// ig.currentLang is probably set from localStorage.
			// if it is an added locale, then ignore the 'english'
			// that we leave in the options.
			if (id != null)
				globals.options["language"] = id;
			this.parent(globals);
		};
		var patch_saved_globals = function(globals) {
			this.parent(globals);
			var langid = globals.options["language"];
			// do not store the id of an added locale into the
			// options, because the game can not recover from
			// a missing id.  That, and ids of added locales may
			// change anyway.
			if (loc_me.get_locale_by_index(langid))
				// Store english in the options.
				globals.options["language"] = 0;
		};

		sc.OptionModel.inject({
			_checkSystemSettings : patched_check_settings,
			onStorageGlobalLoad: patch_loaded_globals,
			onStorageGlobalSave: patch_saved_globals
		});
	});

	// ig.Lang, to find out when the locale is finally known.
	// This is known in ig.main, and this constructor is called afterward.
	ig.module("localize_language_finalized").requires(
		"impact.base.lang"
	).defines(function() {
		ig.Lang.inject({
			'init': function() {
				this.parent();
				loc_me.set_actual_locale(ig.currentLang);
			}
		});
	});

	// ig.Font
	ig.module("localize_patch_font").requires(
		"impact.base.font"
	).defines(function() {
		// We want to do two things here:
		// - patch the flags (later ...)
		// ig.Font.inject({...})
		// - patch the font to match the encoding of the locale.
		ig.MultiFont.inject({
			'init': function(...varargs) {
				this.parent.apply(this, varargs);
				this.FONTPATCHER = new FontPatcher();
			},
			'pushColorSet': function(key, img, color) {
				this.parent(key, img, color);

				var old_onload = img.onload.bind(img);
				var fontpatcher = this.FONTPATCHER;
				// let's patch those images only. let the other
				// mods patch up everything else :)
				img.onload = function() {
					fontpatcher.patch_image_async(this.data
					).then((result) => {
						this.data = result;
					}).then(old_onload.bind(this));
				};
			},
			'onload': function(img) {
				// This is called only for the base font.
				// NOTE: img seems to be ignored by the parent.
				//
				// then() will call _loadMetrics
				var then = this.parent.bind(this, img);
				this.FONTPATCHER.prepare_patch(this).then(then);
			},
			'_loadMetrics': function(img) {
				this.parent(img);
				this.FONTPATCHER.metrics_loaded(this);

				// Start by patching the base font right away.
				this.data = this.FONTPATCHER.patch_image_sync(
					img
				);
			}
		});
	})

	var number_formatter = new NumberFormatter(loc_me);
	number_formatter.hook_into_game();

	$.ajaxPrefilter("json", function(options) {
		var old_url = options.url;

		var base_path = ig.root + "data/";
		if (!old_url.startsWith(base_path))
			return options;
		var relpath = old_url.slice(base_path.length);
		var altrelpath = null;

		var is_lang_label = true;
		if (options.context.constructor === ig.Lang) {
			var lang = ig.currentLang;
			options.url = loc_me.get_replacement_url(old_url, lang);
			is_lang_label = false;
			altrelpath = relpath;
			relpath = options.url.slice(base_path.length)
		}

		var old_resolve = options.success;
		var old_reject = options.error;

		options.success = function(unpatched_json) {
			var resolve = old_resolve.bind(this);
			var reject = old_reject.bind(this);
			var res;
			if (is_lang_label)
				res = loc_me.patch_langlabels(relpath,
							      unpatched_json);
			else
				res = loc_me.patch_langfile(relpath,
							    unpatched_json,
							    altrelpath);
			res.then(resolve, reject);
		};
		return options;
	});

	if (window.location.search.indexOf("en_LEA") !== -1) { // test
		var lea = ["Hi", "Lea", "Why", "How", "Sorry"];
		var pick = ()=>lea[Math.floor(Math.random() * lea.length)];
		var leaize = l => (l.en_US || l).replace(/[a-z0-9]+/ig, pick);
		// note: since we accept any file, the first picked pack file
		// will use en_US, not en_LEA...
		var tdp = a => "lang/sc/gui.en_US.json/labels/title-screen/"+a;

		var sample = { // sample pack
			[tdp("start")]:{ text:"Hi Lea!" },
			[tdp("continue")]:"Hz!",
			[tdp("exit")]:{ orig:"Exit", text:"Bye!"},
			[tdp("options")]:{
				ciphertext:"bs3vYXPQ/u7rS+SticlLbQ==",
				mac:"XGMETe2il+2rZk0HoGEv1g=="
			},
			[tdp("gamecode")]:{
				ciphertext:"xmXKwEq0BRO4sztTHS8+3g=="
			},
			[tdp("pressStart")]:{ orig: "stale", text:"BAAAAAAAD"},
			[tdp("load")]:{
				ciphertext:"q78V2H5p7aWtQYLiXKOMJQ==",
				mac:"garbagegarbagegarbageg=="
			}
		};
		window.localizeMe.add_locale("en_LEA", {
			from_locale: "en_US",
			map_file: () => (path) => (dict_path) => sample,
			missing_cb: leaize,
			language: {
				en_LEA: "Hi Lea!",
				en_US: "Lea's English"
			},
			text_filter: text => text.replace("z", "i"),
			patch_font: (source, context) => {
				if (!context.done) {
					var ee = context.get_char_pos('\u00e9');
					context.set_char_pos('e', ee);
					context.done = true;
				}
				return source;
			},
			pre_patch_font: () => (
				new Promise((resolve) => setTimeout(resolve,
								    5000))
			)
		});
	}
}

})();
