(() => {
	"use strict";
class LocalizeMe {
	constructor() {
		this.added_locales = {};
		// If the index is a native, then it is mapped to null.
		this.locales_by_index = {};
		this.locale_count = 0;

		this.loaded_locale = null;
		this.from_locale = null;

		this.map_file = null;
		this.url_cache = {};
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
	 *		   font or apply similar transformations.
	 *
	 * This function should be called in postload. This object is created
	 * during preload, so it will be availlable.
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

	// Get a index for a given locale name, or 0 (english) if not found.
	get_index_for_locale(locale) {
		var options = this.added_locales[locale];
		if (!options) {
			console.error("unknown locale " + locale);
			return 0;
		}
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
	async get_map_file(current_locale) {
		if (current_locale === this.loaded_locale)
			// may return a promise not resolved yet.
			return this.map_file;

		var localedef = this.added_locales[current_locale];
		var url_or_func = localedef.map_file;

		this.map_file = this.fetch_or_call(url_or_func)
		    .then(result => {
			var ret;
			if (typeof result !== "function")
				ret = (url_to_patch) => result[url_to_patch];
			else
				ret = result;
			this.map_file = ret;
			return ret;
		    });

		// it's not loaded yet, but the promise will eventually resolve
		this.loaded_locale = current_locale;
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
	async get_transpack(json_path, json, current_locale) {
		var map_file = await this.get_map_file(current_locale);
		var url_or_func = map_file(json_path, json, current_locale);
		var result;
		if (url_or_func) {
			result = await this.fetch_or_call(url_or_func);
			if (typeof result !== "function") {
				var saveme = result;
				result = dict_path => saveme[dict_path];
			}
		} else
			result = () => null;
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
	async patch_langlabels(path, json, current_locale) {
		var locale = this.added_locales[current_locale];
		if (!locale)
			return json;

		var pack = await this.get_transpack(path, json, current_locale)
				     .catch(() => (() => null));

		this.for_each_langlabels(json, path,
					 (lang_label, dict_path) => {
			var trans = pack(dict_path, lang_label);
			var text = this.get_text_to_display(trans, lang_label);
			lang_label[current_locale] = text;
		});
		return json;
	}

	/*
	 * Return a pack suitable for patching langfiles.
	 *
	 * This is like get_transpack(), except this also handles if the
	 * translation pack is a full langfile replacement.
	 */
	async get_langfile_pack(path, json, current_locale) {
		var pack = await this.get_transpack(path, json, current_locale)
				     .catch((a) => {
					     console.log("failed path", path,a);
					     return () => null
				     });
		if (pack("DOCTYPE") !== "STATIC-LANG-FILE")
			return pack; // normal pack.

		// it's not really a pack ... more like a json langfile that
		// we parsed like a pack, but we can recover.
		if (pack("feature") !== json["feature"]) {
			console.error("mismatch between lang file feature :",
				      pack("feature"), "!=", json["feature"]);
			return () => null;
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
	patch_language_list(gui_langfile_json, current_locale) {
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
			array.push(lang_name[current_locale]
				   || lang_name[locale]
				   || "ERROR NO LANGUAGE");
		}
	}

	/*
	 * Patch the given langfile loaded in json.
	 *
	 * path should be realive to assets/data/.
	 *
	 * Resolves to a modified json object.
	 */
	async patch_langfile(path, json, current_locale) {

		if (this.added_locales[current_locale]) {
			var pack = await this.get_langfile_pack(path, json,
								current_locale);
			await this.patch_langfile_from_pack(json, path, pack);
		}
		// patch the language list after patching the langfile,
		// otherwise, the added languages will be considered
		// as missing text.
		if (path.startsWith("lang/sc/gui."))
			this.patch_language_list(json, current_locale);
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
	get_replacement_url(url, current_locale) {
		var localedef = this.added_locales[current_locale];

		if (!localedef)
			return url;

		var new_url = url.replace(current_locale,
					  localedef.from_locale);
		if (new_url === url)
			console.warn("Cannot find current locale in url", url);
		return new_url;
	}
}
window.localizeMe = new LocalizeMe();

document.addEventListener('postload', () => {
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
				this.values.language = index;
				console.log("Found missing locale " + locale);
				console.log("Set index to " + index);
			}
			var locale = loc_me.get_locale_by_index(this.values
								    .language);
			if (locale === undefined) {
				// So someone uninstalled an added locale ?
				// the original code will not recover from
				// that, so fix it ourself.
				this.values.language = "0";
				locale = "en_US";
			}

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
		sc.OptionModel.inject({
			_checkSystemSettings : patched_check_settings
		});
	});


	// While simplify already provide some stuff to patch requests,
	// it's said that simplify is deprecated ... whatever.
	$.ajaxPrefilter("json", function(options) {
		var old_url = options.url;

		var relpath = ig.root + "data/";
		if (!old_url.startsWith(relpath))
			return options;
		relpath = old_url.slice(relpath.length);

		var is_lang_label = true;
		if (options.context.constructor === ig.Lang) {
			var lang = ig.currentLang;
			options.url = loc_me.get_replacement_url(old_url, lang);
			console.log("ajax:", relpath, "->", options.url);
			is_lang_label = false;
		}

		var old_resolve = options.success;
		var old_reject = options.error;
		//console.log("ajax: fetching", relpath);

		options.success = function(unpatched_json) {
			var resolve = old_resolve.bind(this);
			var reject = old_reject.bind(this);
			var res;
			if (is_lang_label)
				res = loc_me.patch_langlabels(relpath,
							      unpatched_json,
							      ig.currentLang);
			else
				res = loc_me.patch_langfile(relpath,
							    unpatched_json,
							    ig.currentLang);
			res.then(resolve, reject);
		};
		return options;
	});

	if (false) { // test
		var lea = ["Hi", "Lea", "Why", "How", "Sorry"];
		var pick = ()=>lea[Math.floor(Math.random() * lea.length)];
		var leaize = l => (l.en_US || l).replace(/[a-z0-9]+/ig, pick);
		var tdp = a => "lang/sc/gui.en_LEA.json/labels/title-screen/"+a;

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
		window.localizeMe.add_locale("en_LEA",
			{from_locale: "en_US",
			 map_file: () => (path) => (dict_path) => sample,
			 missing_cb: leaize,
			 language: {
				en_LEA: "Hi Lea!",
				en_US: "Lea's English"
			 },
			 text_filter: text => text.replace("z", "i")
			});
	}
});

})();
