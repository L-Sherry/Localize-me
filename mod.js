/**
 * This whole mess deserves an explanation.  When the game loads, the following
 * normally happens:
 *
 * - Before the game's main() has a chance to run, we patch the ig.LANG_DETAILS
 *   (which contains the locale information) and sc.LANGUAGE, which
 *   contain a mapping from indexes to locales. These indexes are used in the
 *   settings dialogs. These are typically not available when the game's code
 *   is loaded, but only later during initialisation of main's dependencies.
 *
 * - main() runs, and tries to determine the final language to be used by the
 *   game. For that, it looks at localStorage and if not, it auto-detects it
 *   with LANG_DETAILS's useFor.  if localStorage contains an unknown locale,
 *   this part of the code can recover from it by switch back to english
 *   and saving that in localStorage.  It should be noted that localStorage
 *   represent a locale as text (e.g. en_US).
 *
 * - Once the "final" language is determined, it is stored in ig.currentLang.
 *   This is the language that will be used for the remaining of the game, and
 *   changing it requires a restart.  We patch an unrelated part of the code
 *   just to have an event trigger when this happens, because other things in
 *   this mod absolutely want to know which language we should actually patch
 *   in.
 *
 * - The game continues to load, and starts to initialize its options in
 *   sc.OptionModel's constructor.  This is where the mess begins.
 *   These is a game option named "language" that duplicate what's in
 *   localStorage, except it's an integer and not a string, because that's
 *   easier to handle in OptionModel.  The game has a mapping from this
 *   integer to a string, in a local variable that we can't access.
 *   Duplicating it would be too fragile.  The constructor first initializes
 *   "language" to it's default value, which is normally 0, but i think previous
 *   versions of the game could leave it unset.
 *
 * - Then, it uses the internal mapping to convert the final language into
 *   an integer.  This code has the property that if the final language is
 *   unknown to the mapping, then "language" is left unmodified.  So if this a
 *   locale added by us, "language" may be 0 or it may be undefined, in which
 *   case we better patch this quickly, before the game crashes.
 *
 * - Right after that, it calls code (let's call it setOption, which is much
 *   clearer than its actual name _checkSystemSettings), that... translate the
 *   "language" integer into a locale name using the internal mapping, before
 *   storing it in localStorage.  This setOption() thing is tricky, because it
 *   is used in loads of places other than the constructor.  But say that we
 *   cannot detect this case reliably, so we allow "language" values that do
 *   not match the final language at this point.
 *
 * - The game continue to load, and loads the file containing both savefiles
 *   and game options (or select default options).  After that, it calls
 *   onStorageGlobalLoad(), which the options that were loaded.
 *   it will update the options from what was loaded and then it will call...
 *   setOption() on them. Yep.  We patch onStorageGlobalLoad to patch the
 *   "language" mess there, because it is only called during initialization.
 *
 * - If the user goes into the options and select a language, then setOption()
 *   is also called in this case.  The user basically clicked on an integer,
 *   and this function is responsible for storing it into localStorage as well
 *   as the options.
 *
 * - When the game wants to save options, it calls onStorageGlobalSave, which
 *   we also patch.  We do not want to save our added locales's integer into
 *   the save file, because the game cannot recover from that if localize-me
 *   gets uninstalled.  So we always save 0 and we make it that
 *   onStorageGlobalLoad ignores the saved option if the final locale is a
 *   custom one.
 */
class GameLocaleConfiguration {
	constructor() {
		// locale definitions here.  the native ones are not present.
		this.added_locales = {};
		// native locales are mapped to null, because we don't know
		// their indexes.  It can also be used to distinguish between
		// added locales and completely unknown indexes.
		this.localedef_by_index = {};
		// Total number of locales in the game, including the native
		// ones.
		this.locale_count = 0;
		// Until the game determines the language to use for this run,
		// this is a promise.  After which, it is the language used
		// by the game.
		this.final_locale = new Promise((resolve) => {
			this.set_final_locale = (locale) => {
				console.log("final language set to ", locale);
				this.final_locale = locale;
				resolve(locale);
			};
		});
		// When all locales have been loaded from mods, this resolves
		// to an locale -> localedef mapping
		this.all_locales = new Promise(resolve => {
			this.set_all_locales_ready
				= () => resolve(this.added_locales);
		});
	}

	// Add a custom locale definition.  Can be called any time before the
	// patch_game_locale_definitions() is called, which happen after the
	// game starts but before main().
	add_locale_definition(name, localedef) {
		if (name in this.added_locales) {
			console.error("Language " + name + " added twice");
			return;
		}
		if (this.locale_count) {
			console.error("Language " + name
				      + " is added too late !");
			return;
		}
		this.added_locales[name] = localedef;
	}

	// Called during the initialisation of the game.  The final locale
	// is typically unknown at this point.
	patch_game_locale_definitions () {
		let count = 0;
		for (const locale in window.ig.LANG_DETAILS) {
			if (this.added_locales[locale]) {
				console.warn("Language " + locale
					     + " already there");
				delete this.added_locales[locale];
			}
			count++;
		}
		for (const lang in window.sc.LANGUAGE) {
			// lang is not a locale name... this would have made
			// things much simpler if it was...
			const locale_index = window.sc.LANGUAGE[lang];
			this.localedef_by_index[locale_index] = null;
		}

		const added = Object.keys(this.added_locales);
		added.sort();
		for (const locale of added) {
			const options = this.added_locales[locale];
			const locale_index = count++;
			options.localizeme_global_index = locale_index;
			window.ig.LANG_DETAILS[locale] = options;
			window.sc.LANGUAGE["LOCALIZEME"+locale] = locale_index;
			this.localedef_by_index[locale_index] = locale;
		}
		this.locale_count = count;
		this.set_all_locales_ready();
	}

	/**
	 * Get the language that the game will use for the remaining of this
	 * session.
	 *
	 * If unknown, a promise is returned, else, a locale name is returned.
	 * Note that, when the game is loaded, the same information is
	 * available at ig.currentLang.  During loading, however,
	 * ig.currentLang might be incorrect.
	 */
	get_final_locale () {
		return this.final_locale;
	}
	get_localedef_sync() {
		return window.ig.LANG_DETAILS[this.final_locale];
	}
	async get_localedef() {
		await this.final_locale;
		return window.ig.LANG_DETAILS[this.final_locale];
	}
	/// Get all locales once they are loaded.
	async get_all_locales() {
		return this.all_locales;
	}

	/*
	 * patch lang/sc/gui.$locale.json/labels/options/language.group
	 *
	 * this is an array indexed by locale indexes, which is used in the
	 * option menu to display languages.
	 */
	patch_game_language_list(language_list) {
		for (let patched = language_list.length;
		     patched < this.locale_count;
		     ++patched) {
			const locale = this.localedef_by_index[patched];
			if (!locale) {
				console.error("language array out of sync ?",
					      "patched ", patched, " out of ",
					      this.locale_count, " size is ",
					      language_list.length);
				language_list.push("ERROR");
				continue;
			}
			const lang_name = this.added_locales[locale].language;
			language_list.push(lang_name[this.final_locale]
					   || lang_name[locale]
					   || "ERROR NO LANGUAGE");
		}
	}

	// Will only work for added locales, we can't get to the others.
	get_index_of_locale(locale) {
		const localedef = this.added_locales[locale];
		if (!localedef)
			return null;
		return localedef.localizeme_global_index;
	}

	hook_into_game() {

		// ig.LANG_DETAILS defined in game.config
		// sc.LANGUAGE_ICON_MAPPING may need an update if we want flags
		// one day.
		// sc.LANGUAGE defined in game.feature.model.options-model
		ig.module("localize_put_locales").requires(
			"game.config",
			"game.feature.model.options-model"
		).defines(this.patch_game_locale_definitions.bind(this));

		const localedef_by_index = this.localedef_by_index;
		const index_by_locale = this.get_index_of_locale.bind(this);

		// We completely ignore the locale from the save file for
		// added locales.
		const patch_loaded_globals = function (globals) {
			const id = index_by_locale(ig.currentLang);
			if (id !== null) {
				if (globals.options === undefined)
					globals.options = {};
				globals.options.language = id;
			}
			this.parent(globals);
		};
		// And we save a 0 if it is an added locale.
		const patch_saved_globals = function (globals) {
			this.parent(globals);
			const locale_index = globals.options["language"];
			if (localedef_by_index[locale_index])
				globals.options["language"] = 0;
		};

		// Hack up the function called to check and set parameters,
		// either initialized on startup, loaded from the save file or
		// manually selected by the user. We can't really tell.
		const patched_check_settings = function(setting) {
			if (setting !== "language")
				return this.parent(setting);

			// This should not happen anymore, on the latest game
			// versions.
			if (!this.values.hasOwnProperty("language"))
				this.values.language = 0;

			let locale = localedef_by_index[this.values.language];

			// Previous localize-me versions saved the locale index
			// in the options.  If the index does not match a known
			// locale, then recover from it quickly before bad
			// things happens.
			if (locale === undefined) {
				console.log("Recovered from missing locale");
				this.values.language = 0;
				locale = null;
			}

			if (locale === null)
				// native locale, we don't have access to
				// the mapping...
				return this.parent(setting);

			localStorage.setItem("IG_LANG", locale);
			console.log("Locale set to " + locale
				    + " in localStorage");
			return undefined;
		};

		ig.module("localize_patch_up_option_model").requires(
			"game.feature.model.options-model"
		).defines(function() {
			sc.OptionModel.inject({
				_checkSystemSettings : patched_check_settings,
				onStorageGlobalLoad : patch_loaded_globals,
				onStorageGlobalSave : patch_saved_globals,
			});
		});


		const set_final_locale = this.set_final_locale.bind(this);
		const init_lang = function() {
			this.parent();
			set_final_locale(ig.currentLang);
		};

		// ig.Lang, to find out when the locale is finally known.
		// This is known in ig.main, and this constructor is called
		// afterward. (this object is responsible for loading the
		// lang files).
		ig.module("localize_language_finalized").requires(
			"impact.base.lang"
		).defines(function() {
			ig.Lang.inject({ init: init_lang });
		});
	}
}

// This thing is turning into a god class...
class JSONPatcher {
	constructor(game_locale_config) {
		this.game_locale_config = game_locale_config;
		this.map_file = undefined;
		this.url_cache = {};

		// Function returned by various methods when things are not
		// found. This allows callers to either use it blindly or check
		// if it not_found
		this.not_found = () => null;

		if (window.ccmod)
			this.load_json = this.constructor.load_json_ccloader3;
		else
			this.load_json = this.constructor.load_json_fetch;
	}

	static async load_json_fetch(url) {
		const response = await fetch(url);
		if (!response.ok)
			return Promise.reject(response);
		return response.json();
	}

	static async load_json_ccloader3(url) {
		const resolved = window.ccmod.resources.resolvePathToURL(url);
		return window.ccmod.resources.plain.loadJSON(resolved);
	}

	/*
	 * If thing is a string, treat it as an URL and fetch its JSON,
	 * else assume it is a function and call it without any argument.
	 * The function may return a promise.
	 *
	 * JSON objects refered by their URL are cached.
	 */
	async fetch_or_call(thing) {
		if (thing.constructor !== String)
			return await thing();

		const cached = this.url_cache[thing];
		if (cached)
			return cached;

		const ret = this.load_json(thing);
		this.url_cache[thing] = ret;
		ret.then(() => { delete this.url_cache[thing]; });
		return ret;
	}

	async load_map_file() {
		const localedef = await this.game_locale_config.get_localedef();
		if (!localedef) {
			console.error("trying to patch locales without locale");
			return null;
		} else if (!localedef.map_file || !localedef.from_locale)
			// native, no need to patch
			return null;

		const result = await this.fetch_or_call(localedef.map_file);

		if (typeof result === "function")
			return result;

		const prefix = localedef.url_prefix || "";
		return (url_to_patch) => {
			const ret = result[url_to_patch];
			if (!ret)
				return null;
			return prefix + ret;
		};
	}

	/*
	 * Get a map file for the given current locale.
	 *
	 * This returns a map_file function that maps assets path relative to
	 * assets/data/ into a translation pack url, or a function
	 * returning a json or function.
	 *
	 * If nothing needs to be patched, this returns null.
	 *
	 * the map_file function is cached for later use.
	 */
	async get_map_file() {
		if (this.map_file === undefined)
			this.map_file = this.load_map_file();
		return this.map_file;
	}

	/*
	 * Get a translation pack for the given path and json and locale.
	 *
	 * The path must be relative to assets/data.
	 *
	 * If patching is disabled, this returns null.
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
	 *
	 * If a translation result is unknown, null or undefined is returned.
	 */
	async get_transpack(json_path, json) {
		const map_file = await this.get_map_file();
		if (!map_file)
			return null;

		const url_or_func = map_file(json_path, json);
		if (!url_or_func)
			return this.not_found;

		const result = await this.fetch_or_call(url_or_func);
		if (typeof result !== "function")
			return dict_path => result[dict_path];
		return result;
	}

	/**
	 * Walk recursively into the json object.  This is a prefix walk.
	 * This recurses into arrays and objects with an API like Array.forEach.
	 * cb is called with: (value, index, array_or_object, dict_path)
	 * where, array_or_object[index] === value and dict_path is a
	 * slash-separated path to the value.
	 *
	 * cb is called before recursing into the value. If cb returns a trueish
	 * value, then this recursion is skipped.
	 */
	recurse_json(json, dict_path, cb) {
		if (json === null)
			return;
		const try_recurse = (value, index) => {
			const new_dict_path = dict_path + "/" + index;
			if (!cb(value, index, json, new_dict_path))
				this.recurse_json(value, new_dict_path, cb);
		};
		if (Array.isArray(json))
			json.forEach(try_recurse);
		if (json.constructor === Object)
			for (const index in json)
				if (json.hasOwnProperty(index))
					try_recurse(json[index], index);
	}

	/**
	 * Given a translation result, get the translation of the given
	 * string or lang label.
	 *
	 * This function does not support lang labels mappings to array or
	 * objects.  Thanksfully, these appear to be currently unused.
	 *
	 * Returns a translation result or null if the translation is unknown.
	 */
	get_translation_result(pack_function, dict_path, lang_label_or_string) {
		const result = pack_function(dict_path, lang_label_or_string);
		const localedef = this.game_locale_config.get_localedef_sync();
		if (result === null || result === undefined)
			return { result: null, text: null };
		if (result.constructor === String)
			return { result, text: result };
		const orig = (lang_label_or_string[localedef.from_locale]
			      || lang_label_or_string);
		if (result.orig && orig && result.orig !== orig)
			// original text has changed, translation is stale.
			return { result, text: null };
		if (result.text !== undefined)
			return { result, text: result.text };
		return { result: null, text: null };
	}

	/**
	 * Given a translated string, get the text to display
	 *
	 * This is the generic post-processing function after finding a trans
	 * result.
	 *
	 * If translated text is non-null, then call text_filter
	 * with the given trans_result and ignore the other parameters.
	 *
	 * If translated_text is null, then call the missing callback
	 * or return the original text prefixed by "--", unless skip_missing
	 * is true, in which case it will be returned unmodified.
	 */
	get_text_to_display(translated_text, trans_result,
			    lang_label_or_string, dict_path,
			    skip_missing) {
		const localedef = this.game_locale_config.get_localedef_sync();
		if (translated_text !== null) {
			if (localedef.text_filter)
				return localedef.text_filter(translated_text,
							     trans_result);
			return translated_text;
		}

		const missing = localedef.missing_cb;
		let ret = undefined;
		if (missing)
			ret = missing(lang_label_or_string, dict_path);
		if (ret === undefined) {
			ret = lang_label_or_string[localedef.from_locale];
			if (ret === undefined)
				ret = lang_label_or_string;
			if (!skip_missing)
				ret = "--" + ret;
		}
		return ret;
	}

	/**
	 * Given a pack, get the translation of the given string or lang label.
	 *
	 * Always returns a string, which is already post-processed by
	 * get_text_to_display().
	 */
	get_from_pack(pack_function, lang_label_or_string, dict_path,
		      skip_missing) {
		const { result, text }
			= this.get_translation_result(pack_function, dict_path,
						      lang_label_or_string);
		const ret
			= this.get_text_to_display(text, result,
						   lang_label_or_string,
						   dict_path, skip_missing);
		return ret;
	}

	/*
	 * Patch the lang labels in the json object loaded at file_path
	 * for the given current locale.
	 *
	 * Resolves to the json parameter, possibly modified.
	 */
	async patch_langlabels(file_path, json) {
		const lang_labels = [];
		const collect_lang_labels = (obj, index, parent, dict_path) => {
			if (!obj || typeof obj !== "object"
			    || !("en_US" in obj || "langUid" in obj))
				return false;
			lang_labels.push({ dict_path, lang_label: obj });
			return true;
		};

		this.recurse_json(json, file_path, collect_lang_labels);

		// While the game is careful to never block on a resource, mods
		// are much less inclined to.  Mods can block on a jquery
		// resource in their postload. And we block resources until we
		// know which locale to patch, which requires all postload to
		// finish and the game to start.  You see the deadlock now ?
		//
		// As a partial workaround, do not block if the file does not
		// contain any lang label.
		if (lang_labels.length === 0)
			return json; // nothing to patch

		const pack = await this.get_transpack(file_path, json)
				       .catch(() => this.not_found);
		if (!pack)
			return json; // native locale

		for (const { dict_path, lang_label } of lang_labels)
			lang_label[ig.currentLang]
				= this.get_from_pack(pack, lang_label,
						     dict_path);
		return json;
	}

	/*
	 * Patch lang/sc/gui.*.json when used with ccloader v3
	 *
	 * This reimplements ccloader v3's localized fields
	 */
	patch_ccloader3_mods(json, path, pack) {
		if (!window.modloader)
			return; // not ccloader v3
		const { from_locale }
			= this.game_locale_config.get_localedef_sync();
		const { options } = json.labels;

		const localize_field = (maybe_ll, field_name, prefix) => {
			// technically not a lang label, but close enough
			if (!maybe_ll)
				return " ";
			const text = maybe_ll[ig.currentLang];
			if (text)
				return this.get_text_to_display(text, {});
			if (maybe_ll.constructor !== String
			    && maybe_ll[from_locale] === undefined)
				return maybe_ll["en_US"] || " ";

			const dict_path = `${prefix}/${field_name}`;
			return this.get_from_pack(pack, maybe_ll, dict_path,
						  true);
		};

		window.modloader.loadedMods.forEach((mod, id) => {
			const modEnabled_id = `modEnabled-${id}`;
			if (!options[modEnabled_id])
				return;

			let { title, description } = mod.manifest;

			const prefix
				= `${path}/labels/options/${modEnabled_id}`;
			title = localize_field(title || id, "name", prefix);
			description = localize_field(description, "description",
						     prefix);
			options[modEnabled_id].name = title;
			options[modEnabled_id].description = description;
		});
	}

	/*
	 * Patch the given langfile loaded in json.
	 *
	 * path should be relative to assets/data/.
	 *
	 * If path is not found, the alternate path is tried next.
	 *
	 * Resolves to a modified json object.
	 */
	async patch_langfile(path, json) {
		const pack = await this.get_transpack(path, json);

		const patcher = (value, index, json, dict_path) => {
			if (value.constructor !== String)
				return;
			json[index] = this.get_from_pack(pack, value,
							 dict_path);
		};
		if (pack) {
			this.recurse_json(json.labels, path + "/labels",
					  patcher);

			if (path.startsWith("lang/sc/gui."))
				this.patch_ccloader3_mods(json, path, pack);
		}

		// patch the language list after patching the langfile,
		// otherwise, the added languages will be considered
		// as missing text.
		if (path.startsWith("lang/sc/gui.")) {
			const langs = json.labels.options.language.group;
			if (!Array.isArray(langs)) {
				console.error("Could not patch language array",
					      "game will likely crash !");
				return json;
			}
			this.game_locale_config.patch_game_language_list(langs);
		}
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
		if (!ig.currentLang)
			console.error("need to patch url without locale set");
		const localedef = window.ig.LANG_DETAILS[ig.currentLang];

		if (!localedef || !localedef.from_locale)
			return url;

		const new_url = url.replace(ig.currentLang,
					    localedef.from_locale);
		if (new_url === url)
			console.warn("Cannot find current locale in url", url);
		return new_url;
	}

	get_patch_opts(jquery_options, base_path_length) {
		let rel_path = jquery_options.url.slice(base_path_length);
		if (!(jquery_options.context
		      && jquery_options.context.constructor === ig.Lang)) {
			const do_patch
				= json => this.patch_langlabels(rel_path, json);
			return { do_patch };
		}
		// langfile.  replace tr_TR by from_locale
		const url = this.get_replacement_url(jquery_options.url);
		rel_path = this.get_replacement_url(rel_path);
		const do_patch = json => this.patch_langfile(rel_path, json);
		return { url, do_patch };
	}

	hook_into_game() {
		const base_path = ig.root + "data/";
		const base_extension_path = ig.root + "extension/";
		$.ajaxPrefilter("json", options => {
			let prefix_length = 0;
			if (options.url.startsWith(base_path))
				prefix_length = base_path.length;
			else if (options.url.startsWith(base_extension_path))
				prefix_length = ig.root.length;
			else
				return options;

			const { do_patch, url }
				= this.get_patch_opts(options, prefix_length);
			options.url = url || options.url;

			const old_resolve = options.success;
			const old_reject = options.error;
			options.success = function(unpatched_json) {
				const resolve = old_resolve.bind(this);
				const reject = old_reject.bind(this);

				do_patch(unpatched_json).then(resolve, reject);
			};
			return options;
		});
	}
}

class LocalizeMe {
	constructor(game_locale_config) {
		this.game_locale_config = game_locale_config;
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
	 *		  URL found in a map file.  Using something based
	 *		  on document.currentScript.src allows your mod
	 *		  to be relocatable. It should most of the time
	 *		  end with '/'.
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
	 *
	 * - "patch_base_font" an optional function called for each loaded font.
	 *
	 *		  Can be used to change the encoding of displayed text,
	 *		  add missing characters or more.  Called with
	 *		  (loaded_image (not scaled), context), where
	 *		  loadded_image is the base image of the font with
	 *		  white characters. context is unique per multifont
	 *		  and contains these fields and methods:
	 *
	 *		  char_height : the height of the font.
	 *
	 *		  size_index : the size index as used by the game.
	 *
	 *		  base_image : the white image loaded by the game.
	 *
	 *		  color : the color of the currently-patched image.
	 *
	 *		  get_char_pos(c) -> { x, y, width, height } to get
	 *		  the position of a char in loaded_image.
	 *
	 *		  set_char_pos(c, { x, y, width, height }) to change it.
	 *
	 *		  reserve_char(canvas, width) -> {x, y, width, height}
	 *		  to allocate free space in the font.
	 *
	 *		  import_from_font(canvas_dest,ig_font,start_char) to
	 *		  import all characters of an ig.Font into the canvas
	 *		  using reserve_char(), starting at start_char.
	 *
	 *		  recolor_from_base_image(canvas_dest) to take the white
	 *		  image and recolor it into canvas_dest
	 *
	 *		  This context is carried out to patch_font, so you
	 *		  may store stuff in there.
	 *
	 *		  This function can not block, use pre_patch_font to
	 *		  perform asynchronous operations (like, loading images)
	 *
	 * - "patch_font" an optional function called for each color of each
	 *		  font.  It is called after "patch_base_font".
	 *		  Can be used to change the encoding of displayed text,
	 *		  add missing characters or more.  Called with
	 *		  (loaded_image (not scaled), context), where context
	 *		  is unique per multifont and contains the same fields
	 *		  as "patch_base_font", minus `reserve_char` and
	 *		  `import_from_font`.
	 *
	 *		  This function can not block, use pre_patch_font to
	 *		  perform asynchronous operations (like, loading images)
	 *
	 * - "pre_patch_font" an optional function that is called before
	 *		      patch_base_font.  Unlike patch_base_font,
	 *		      this one may return a promise and will be called
	 *		      once per font.  Takes a context containing
	 *		      "char_height" (height of font),
	 *		      "size_index" (as used by the game) and
	 *		      "base_image" (the base image of a multifont).
	 *		      "set_base_image(img)" (replaces base_image before
	 *		      the games parses it)
	 *		      This context is carried out to patch_base_font and
	 *		      patch_font, so you may store stuff in there.
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
	 *				must be displayed (as in toFixed())
	 *		     'units' is either empty, or contains an unit.
	 *			     currently, only '%', 'm' and 'km' are used.
	 *			     it should be suffixed or to the number
	 *		     'template' is passed only if 'number_locale' is
	 *				defined: this is the number formatted
	 *				by toLocaleString as if only
	 *				'number_locale' was defined.  It is
	 *				this possible to reuse this formatted
	 *				number instead of recoding everything
	 *				from scratch.
	 * - "misc_time_function" If set, then this function will be called
	 *			  when the game want the value \v[misc.time].
	 *			  This variable is used in the Golden Revolver
	 *			  description.
	 *			  (item-database.json/items/327/description)
	 *
	 *			  The game defines it as an hardcoded english
	 *			  text, dynamically generated in the code.
	 *			  If the current time is between 11:00 am and
	 *			  1:59 pm, it returns "It's High Noon", else,
	 *			  It returns the formatted current time.
	 *
	 *			  Note that the game currently has a bug,
	 *			  because it references it as
	 *			  "It's \v[misc.time]", so when it's noon,
	 *			  it displays "It's It's High Noon".
	 * - "flag" If set, then display this flag next to the language in the
	 *	    options.  It can be an URL to an image, an image or canvas,
	 *	    or a asnyc function returning one.  The flag must be of
	 *	    size 18x12, like flags in assets/media/font/languages.png.
	 *
	 * This function should be called before the game starts to run.
	 */
	add_locale(name, options) {
		this.game_locale_config.add_locale_definition(name, options);
	}
}

/*
 * Patches a multifont.
 *
 * This class is typically instanciated once per multifont to patch.
 */
class FontPatcher {
	constructor(multifont, localedef_promise) {
		this.metrics_loaded_promise = new Promise((resolve) => {
			this.resolve_metrics_loaded = resolve;
		});
		this.context = null;
		this.resized_height = null;
		this.free_space = null;

		this.localedef_promise = localedef_promise.then(localedef => {
			if (localedef.patch_font || localedef.pre_patch_font
			    || localedef.patch_base_font)
				return localedef;
			return null; // means there is nothing to patch.
		});
		// some non-async code need the localedef. Hopefully, we await
		// it before they are called.
		this.localedef_promise.then(localedef => {
			this.localedef_promise = localedef;
		});
	}

	/*
	 * Call the pre_patch_hook then wait for it to complete.
	 */
	async pre_patch(multifont) {
		const localedef = await this.localedef_promise;
		if (!localedef)
			return;
		this.context = { char_height: multifont.charHeight,
				 size_index: multifont.sizeIndex,
				 base_image: multifont.data,
				 set_base_image: new_image => {
					 multifont.data = new_image;
				 }
			       };
		if (localedef.pre_patch_font)
			await localedef.pre_patch_font(this.context);
		delete this.context.set_base_image;
	}

	/**
	 * Increase the height of an ig.Image
	 *
	 * This only works for images without filters or resizing.
	 *
	 * If new_height is equal to image_or_canvas.height, then this
	 * turns an image into a canvas.
	 */
	static resize_image(image_or_canvas, new_height) {
		console.assert(new_height >= image_or_canvas.height);
		// won't work for generic images. Use with care.
		const canvas = document.createElement("canvas");
		canvas.width = image_or_canvas.width;
		canvas.height = new_height;
		const context2d = canvas.getContext("2d");
		context2d.drawImage(image_or_canvas, 0, 0);
		return canvas;
	}

	/**
	 * Increase the height of an ig.Image without changing its canvas
	 *
	 * This only works for images without filters or resizing, where the
	 * ig.Image contains a canvas.
	 */
	static resize_image_inplace(canvas, new_height) {
		const offscreen = document.createElement("canvas");
		{
			offscreen.width = canvas.width;
			offscreen.height = canvas.height;
			const context2d = offscreen.getContext("2d");
			context2d.drawImage(canvas, 0, 0);
		}
		// this will implicitely clear the canvas...
		canvas.height = new_height;
		const context2d = canvas.getContext("2d");
		context2d.drawImage(offscreen, 0, 0);
	}

	/**
	 * Find free space for a new character of given width.
	 *
	 * Returns a {x, y, width, height} rect.  Will resize the canvas
	 * if necessary.
	 *
	 * Probably not a good idea to do this after the base image has been
	 * handed back into the game.
	 */
	reserve_free_space(font, canvas, width) {
		if (this.free_space.x + width + 1 < canvas.width) {
			const ret = { x: this.free_space.x,
				      y: this.free_space.y,
				      width, height: font.charHeight
				    };
			this.free_space.x += width + 1;
			return ret;
		}
		// i don't have to respect the font metric encoding...
		// but i will anyway.
		const true_height = font.charHeight + 1;

		this.free_space.y += true_height;
		this.free_space.x = width + 1;

		const ret = { x: 0,
			      y: this.free_space.y,
			      width, height: font.charHeight
			    };

		if (this.free_space.y + true_height > canvas.height) {

			// no room left. time to resize.
			if (this.resized_height === null)
				this.resized_height = canvas.height;
			this.resized_height *= 2;
			// resize must be done in place, because caller still
			// has a reference to it.
			const cls = this.constructor;
			cls.resize_image_inplace(canvas, this.resized_height);
		}

		return ret;
	}

	/*
	 * Prepare the context for the base image
	 */
	prepare_context_for_base_image(multifont) {
		this.context.get_char_pos = (c) => {
			const index = c.charCodeAt(0) - multifont.firstChar;
			// don't ask me about the +1, ask the game.
			const width = multifont.widthMap[index] + 1;
			const height = multifont.charHeight;
			const x = multifont.indicesX[index];
			const y = multifont.indicesY[index];
			return { x, y, width, height };
		};
		this.context.set_char_pos = (c, rect) => {
			const index = c.charCodeAt(0) - multifont.firstChar;
			multifont.indicesX[index] = rect.x;
			multifont.indicesY[index] = rect.y;
			multifont.widthMap[index] = rect.width - 1;
			if (rect.height !== multifont.charHeight)
				console.warn("bad height for", c);
		};
		const char_count = multifont.widthMap.length;
		this.free_space = { x: multifont.indicesX[char_count - 1]
				     + multifont.widthMap[char_count - 1]
				     + 2,
				    y: multifont.indicesY[char_count - 1] };
		this.context.reserve_char
			= this.reserve_free_space.bind(this, multifont);

		this.context.import_from_font = (canvas, font, start_char) => {
			const start_code = start_char.charCodeAt(0);
			const context2d = canvas.getContext("2d");
			for (let i = 0; i < font.indicesX.length; ++i) {
				const width = font.widthMap[i] + 1;
				const rect = this.context.reserve_char(canvas,
								       width);

				const char_ = String.fromCharCode(start_code
								  + i);
				this.context.set_char_pos(char_, rect);
				const srcx = font.indicesX[i];
				const srcy = font.indicesY[i];
				context2d.drawImage(font.data, srcx, srcy,
						    width, font.charHeight,
						    rect.x, rect.y, rect.width,
						    rect.height);
			}
			return canvas;
		};

		this.context.recolor_from_base_image = (canvas) => {
			const context2d = canvas.getContext("2d");
			context2d.clearRect(0, 0, canvas.width, canvas.height);
			context2d.drawImage(this.context.patched_base_image,
					    0, 0);

			const firstpixel
				= (context2d.getImageData(0,0,
							 canvas.width,
							 canvas.height)
				   .data.slice(0, 4));
			// that's the only way i know to extract a css color
			// components...
			context2d.fillStyle = this.context.color;
			context2d.fillRect(0, 0, 1, 1);
			const imgdata = context2d.getImageData(0,0,
							       canvas.width,
							       canvas.height);
			const data = imgdata.data;
			const color = data.slice(0, 3);
			// restore the mess
			firstpixel.forEach((v,i) => data[i] = v);

			for (let i = 0; i < data.length; i += 4)
				if (data[i] && data[i+3])
					color.forEach((v,j) => data[i+j] = v);

			context2d.putImageData(imgdata, 0, 0);
			return canvas;
		};
	}

	/*
	 * Fetch metrics then unblock all calls waiting for metrics to be
	 * available.
	 *
	 * Also patch the base image after extracting its metrics.
	 */
	on_metrics_loaded(multifont) {
		this.resolve_metrics_loaded();

		// it shouldn't be a promise at this point.
		const localedef = this.localedef_promise;
		if (!localedef)
			return;

		this.prepare_context_for_base_image(multifont);
		this.patch_image(multifont, multifont.color, true);
		this.context.patched_base_image = multifont.data;

		// some operations are no longer possible now.
		delete this.context.reserve_char;
		delete this.context.import_from_font;
	}

	/*
	 * Patch the image, using the localedef's patch_font() method.
	 */
	patch_image(ig_image, color, is_base_font) {
		// it shouldn't be a promise or null at this point.
		const localedef = this.localedef_promise;

		let func_to_call = null;

		if (is_base_font)
			func_to_call = localedef.patch_base_font;
		else {
			func_to_call = localedef.patch_font;
			if (!func_to_call)
				// default implementation that recolors
				// colored fonts from the base font.
				func_to_call = (canvas, context) =>
					context.recolor_from_base_image(canvas);
		}

		if (!func_to_call)
			return;

		let canvas = ig_image.data;
		if (this.resized_height !== null || !canvas.getContext) {
			const cls = this.constructor;
			const height
				= this.resized_height || ig_image.data.height;
			canvas = cls.resize_image(ig_image.data, height);
		}

		this.context.color = color;
		const ret = func_to_call(canvas, this.context);
		if (ret)
			ig_image.data = ret;
		else
			console.warn("patch_font() returned nothing");
	}

	/**
	 * Inject a method, but only for this instance.
	 * The parent is passed as first parameter of functor.
	 */
	static inject_instance(instance, field, functor) {
		const old = instance[field].bind(instance);
		instance[field] = functor.bind(instance, old);
	}

	/** Inject font patcher into a ig.Image instance.
	 *
	 * This instance is assumed to be loaded as part of a color set of a
	 * multifont.
	 */
	inject_color_set_onload(image, color) {
		const cls = this.constructor;
		cls.inject_instance(image, "onload", (old_onload, ignored) => {
			this.metrics_loaded_promise.then(async () => {
				// metrics_loaded depends on localedef_promise
				if (this.localedef_promise)
					this.patch_image(image, color, false);
				old_onload(ignored);
			});
		});
	}

	static hook_into_game(game_locale_config) {
		const localedef_promise = game_locale_config.get_localedef();
		const create_patcher
			= multifont => new FontPatcher(multifont,
						       localedef_promise);

		// ig.MultiFont
		// Here we are praying that we are instanciated before
		// game.feature.font.font-system.
		ig.module("localize_patch_font").requires(
			"impact.base.font"
		).defines(function() {
			// We want to do two things here:
			// - patch the flags (later ...)
			// ig.Font.inject({...})
			// - patch the font to match the encoding of the locale.
			ig.MultiFont.inject({
				"init": function(...varargs) {
					this.parent.apply(this, varargs);
					this.FONTPATCHER = create_patcher(this);
				},
				"pushColorSet": function(key, img, color) {
					this.parent(key, img, color);
					// patch its onload() method.
					this.FONTPATCHER
					    .inject_color_set_onload(img,
								     color);
				},
				"onload": function(ignored) {
					// This is called only for the base
					// font.

					// calls _loadMetrics()
					// then the rest of the loading sequence
					const old_parent
						= this.parent.bind(this,
								   ignored);

					this.FONTPATCHER
					    .pre_patch(this).then(old_parent);
				},
				"_loadMetrics": function(img) {
					this.parent(img);
					this.FONTPATCHER.on_metrics_loaded(this
									  );
				}
			});
		});
	}
}

class NumberFormatter {
	constructor(game_locale_config) {
		// this may stay null if we don't need to patch anything.
		this.localedef = null;
		game_locale_config.get_localedef().then(localedef => {
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
		const locale = this.localedef.number_locale;
		const options = {
			minimumFractionDigits: frac_precision,
			maximumFractionDigits: frac_precision
		};

		let suffix = "";
		if (unit === "%") {
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
		let ret = null;
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
		return Number(number_str.replace(/,/g, "", number_str));
	}

	hook_var_access() {
		const formatter = this;
		const find_number = splitted => {
			if (splitted[0] !== "misc")
				return null;
			if (splitted[1] === "localNum")
				return splitted[2];
			if (splitted[1] === "localNumTempVar")
				return ig.vars.get("tmp." + splitted[2]);
			return null;
		};
		const patched_var_access = function(varname, splitted) {
			if (formatter.localedef) {
				const number = find_number(splitted);
				if (number !== null)
					return formatter.format_number(number);
			}
			return this.parent(varname, splitted);
		};
		ig.module("localizeme_menu_model_numerics")
		  .requires("game.feature.menu.menu-model")
		  .defines(() => {
				   sc.MenuModel.inject({
					  onVarAccess: patched_var_access
				   });
			   });
	}
	hook_meters_statistics () {
		const format_meters = () => {
			if (this.localedef === null)
				return null; // native number formatting
			const steps = sc.stats.getMap("player", "steps") || 0;
			// 1.632 m per step ? that's a pretty big step.
			const meters = steps * 1.632;
			if (meters < 1000)
				return this.format_number(meters, 0, "m");
			return this.format_number(meters / 1000, 2, "km");
		};

		ig.module("localizeme_reimplement_steps")
		  .requires("game.feature.menu.gui.stats.stats-gui-builds")
		  .defines(() => {
				   const cat_gen = sc.STATS_CATEGORY.GENERAL;
				   const general = sc.STATS_BUILD[cat_gen];
				   const meters = general.meters;
				   // This one uses suffix to add fractional
				   // parts, sigh.
				   meters.localize_me_format = format_meters;
			   });

	}
	hook_statistics() {
		// remaining:
		// sc.StatPercentNumber
		// sc.NumberGui (big one)
		const formatter = this;

		const patched_keyvalue_init = function(a, data, c) {
			this.parent(a, data, c);
			if (formatter.localedef === null)
				return;

			if (data.asNumber) // that uses sc.NumberGui.
				return;

			if (data.localize_me_format) {
				const v = data.localize_me_format();
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

			let number = this.valueGui.text;
			number = formatter.unformat_en_us_number(number);
			number = formatter.format_number(number);
			this.valueGui.setText(number);
		};
		const patched_keyvalue_set = function(num, data, suffix) {
			// never used ?
			if (formatter.localedef === null) {
				this.parent(num, data, suffix);
				return;
			}
			const text = data ? formatter.format_number(num) : num;
			this.valueGui.setText(text + (suffix || ""));
		};

		const patched_keyvaluepercent_init = function(a, data, c) {
			this.parent(a, data, c);
			if (formatter.localedef === null)
				return;
			const text = this.numberGui.text;
			// the text is followed by "\\[arrow-percent]"
			const index = text.indexOf("\\");
			let number = text.slice(0, index);
			number = formatter.unformat_en_us_number(number);
			number = formatter.format_number(number);
			this.numberGui.setText(number + text.slice(index));
		};


		// sc.STATS_ENTRY_TYPE.KeyCurMax also uses the dreaded
		// formatter, but it only formats integers between
		// 0 and something like 125, so is that really needed ?
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
			   });

	}

	hook_into_game() {
		this.hook_var_access();
		this.hook_statistics();
		this.hook_meters_statistics();
	}
}

class VariablePatcher {
	constructor (game_locale_config) {
		this.misctime_func = null;
		game_locale_config.get_localedef().then(localedef => {
			this.misc_time_function = localedef.misc_time_function;
		});
	}

	hook_into_game() {
		const me = this;

		const override_misctime = function(parm, varpath) {
			if (varpath[0] === "misc" && varpath[1] === "time"
			    && me.misc_time_function)
				return me.misc_time_function();
			return this.parent(parm, varpath);
		};

		ig.module("localizeme_misc_var")
		  .requires("game.feature.menu.menu-model")
		  .defines(() => {
				sc.MenuModel.inject({
					onVarAccess: override_misctime
				});
			});
	}
}

/*
 * Patch the flags from the various locales.
 *
 * Since flags are icons in a font, this reuses a lot of FontPatcher.
 */
class FlagPatcher {
	constructor(game_locale_config) {
		this.all_locales_promise
			= game_locale_config.get_all_locales();
		// should happen after all_locales_promise
		this.fontsystem_loaded_promise
			= game_locale_config.get_final_locale();
		const cls = this.constructor;
		if (window.ccmod)
			this.load_image = cls.load_image_ccloader3;
		else
			this.load_image = cls.load_image_native;
	}
	static async load_image_native(url) {
		return new Promise((resolve, reject) => {
			const img = new Image;
			img.onload = () => resolve(img);
			img.onerror = reject;
			img.src = url;
		});
	}
	static async load_image_ccloader3(url) {
		const resolved = window.ccmod.resources.resolvePathToURL(url);
		return window.ccmod.resources.plain.loadImage(resolved);
	}
	async load_image_from_img_or_url(something) {
		// This detects both Functions and AsyncFunctions
		if (something instanceof Function)
			something = await something();
		// But something instanceof String does not work... Whatever.
		if (something.constructor !== String)
			return something;
		return this.load_image(something);
	}
	async collect_all_flags() {
		const all_localedefs = await this.all_locales_promise;
		const promises = [];
		for (const locale in all_localedefs) {
			const localedef = all_localedefs[locale];
			const flag = localedef.flag;
			if (!flag)
				continue;
			const promise = this.load_image_from_img_or_url(flag);

			promises.push(promise.then(img => {
				return { img, locale, localedef };
			}));
		}
		// give me my Promise.allSettled
		const flags = [];
		for (const prom of promises)
			try {
				flags.push(await prom);
			} catch (e) {
				console.error("error while loading flag", e);
			}
		return flags;
	}

	patch_flags (font) {
		const patcher = new FontPatcher(font, Promise.resolve({}));
		patcher.context = {};
		patcher.prepare_context_for_base_image(font);
		const context = patcher.context;
		// pick any flag as a base.
		const base_char = String.fromCharCode(font.firstChar);
		const base_rect = context.get_char_pos(base_char);
		// convert flags into a canvas
		const canvas
			= FontPatcher.resize_image(font.data, font.data.height);
		const context2d = canvas.getContext("2d");
		for (const flag of this.all_flags) {
			flag.index = font.indicesX.length;
			const rect = context.reserve_char(canvas,
							  base_rect.width);
			const index = (flag.localedef.localizeme_global_index
				       + font.firstChar);
			context.set_char_pos(String.fromCharCode(index), rect);
			context2d.drawImage(canvas,
					    base_rect.x, base_rect.y,
					    base_rect.width, base_rect.height,
					    rect.x, rect.y,
					    rect.width, rect.height);
			context2d.drawImage(flag.img,
					    rect.x + 1, rect.y + 3,
					    rect.width - 2, rect.height - 4);
		}
		font.data = canvas;

		const add_mappings = this.patch_fontsystem_mappings.bind(this);
		this.fontsystem_loaded_promise.then(add_mappings);
	}
	patch_fontsystem_mappings () {
		const mappings = {};

		const language_iconset
			= sc.fontsystem.font.mapping["language-0"][0];
		for (const flag of this.all_flags) {
			const index = flag.localedef.localizeme_global_index;
			mappings["language-"+index] = [language_iconset, index];
		}
		sc.fontsystem.font.setMapping(mappings);

		delete this.all_flags;
	}

	inject_into(lang_font) {
		FontPatcher.inject_instance(lang_font, "onload",
					    (old_onload, ignored) => {
				this.collect_all_flags().then(all_flags => {
					this.all_flags = all_flags;
					// calls _loadMetrics
					old_onload(ignored);
				});
			});
		const me = this;
		FontPatcher.inject_instance(lang_font, "_loadMetrics",
					    function (old_loadmetrics, img) {
				old_loadmetrics(img);
				me.patch_flags(this);
			});
	}

	hook_into_game() {
		const me = this;
		ig.module("localize_patch_flags").requires(
			"impact.base.font"
		).defines(function() {
			ig.Font.inject({
				init: function(path, height,
					       firstchar, sizeindex,
					       color, ...future) {
					if (path === "media/font/languages.png")
						me.inject_into(this);
					this.parent(path, height, firstchar,
						    sizeindex, color,
						    ...future);
				}
			});
		});

	}
}

const game_locale_config = new GameLocaleConfiguration();
game_locale_config.hook_into_game();

const json_patcher = new JSONPatcher(game_locale_config);
json_patcher.hook_into_game();

FontPatcher.hook_into_game(game_locale_config);

const number_formatter = new NumberFormatter(game_locale_config);
number_formatter.hook_into_game();

const variable_patcher = new VariablePatcher(game_locale_config);
variable_patcher.hook_into_game();

const flag_patcher = new FlagPatcher(game_locale_config);
flag_patcher.hook_into_game();

window.localizeMe = new LocalizeMe(game_locale_config);


if (window.location.search.indexOf("en_LEA") !== -1) { // test
	const lea = ["Hi", "Lea", "Why", "How", "Sorry"];
	const pick = () => lea[Math.floor(Math.random() * lea.length)];
	const shortcut = (val, d3fault) => ( val !== undefined ? val : d3fault);
	const leaize = l => shortcut(l.en_US, l).replace(/[a-z0-9]+/ig, pick);
	// note: since we accept any file, the first picked pack file
	// will use en_US, not en_LEA...
	const tdp = a => "lang/sc/gui.en_US.json/labels/title-screen/" + a;

	const sample = { // sample pack
		[tdp("start")]: { text: "Hi Lea!" },
		[tdp("continue")]: "Hz!",
		[tdp("exit")]: { orig: "Exit", text: "Bye!" },
		[tdp("pressStart")]: { orig: "stale", text: "BAAAAAAAD" }
	};
	window.localizeMe.add_locale("en_LEA", {
		from_locale: "en_US",
		// () => (file_path) => (dict_path) => pack
		map_file: () => () => () => sample,
		missing_cb: leaize,
		language: {
			en_LEA: "Hi Lea!",
			en_US: "Lea's English"
		},
		text_filter: text => text.replace("z", "i"),
		patch_font: (source, context) => {
			if (!context.done) {
				const ee = context.get_char_pos("\u00e9");
				context.set_char_pos("e", ee);
				context.done = true;
			}
			return source;
		},
		pre_patch_font: () => (
			new Promise((resolve) => setTimeout(resolve, 5000))
		)
	});
}
