# How to add a locale/translation to CrossCode using this mod

This document explains how to create a translation mod using Localize-Me.
It may also explain some part of how the game internally works with
translations.

If you haven't checked Localize-Me-Tools and its documentation, you
should maybe also check it out:

https://github.com/L-Sherry/Localize-Me-Tools/tree/master/doc

## Localize-Me API

Localize-Me's API currently only feature only one function:

`window.localizeMe.add_locale(locale_name, locale_options)`

`locale_name` is the name of the locale, using what looks like to be an
unix-like convention of `language_COUNTRY` where language is an ISO 639
language code and `COUNTRY` is a ISO 3166-1 country name.

For example, the game currently defines these locales:

- `en_US` (English as spoken in the US)
- `de_DE` (German as spoken in Germany)
- `zh_CN` (mainland Chinese with simplified characters)
- `ja_JP` (japan's Japanese)
- `ko_KR` (Korean as spoken in Korea)

To find the correct one for your language, either browse the ISO standards
on the net, or, if you are on some unix, well, your OS already knows the
one you are using, so try to use the `locale` command to find out.

`locale_options` is where the magic happens, and represents all the options
of the locale.  Some of these options are handled by localize-me while others
are handled by the game itself.

Localize-Me will set `ig.LANG_DETAILS[locale_name]` to this value. The game is
known to currently use the following optional fields of `locale_options`:

- `useFor` (String): part of the language autoselection: when the game starts
  for the first time, if the browser or nwjs's detected language (as found in
  `navigator.language`, which uses the IETF's language tags[1]) starts with
  this value, then this language will be used by default.

- `systemFont` (String): Use the given font name instead of the default one.
  If falsish, then the game will use rendered PNG fonts that cover only parts
  of latin9 (aka ISO 8859-15).  If set, then the game will render the
  navigator's fonts in a canvas.
  To use your custom fonts, you will have to add a CSS font-face with a link
  to your font. See the font section for details.

- `newlineAnywhere` (Boolean): Allow to break lines on every character.
  The game uses this for cjk languages where there are no explicit word
  separation.
- `newlineException` (Array): As an exception to `newlineAnywhere`, do not
  break lines after these characters.
  The game uses `indexOf` to determine if a character is part of the set, so
  using a String should also work.
- `newlineAfter` (Array): Unconditionally insert a line break after this
  character.  Like `newlineException`, a string should also work.

- `commaDigits` (Boolean): If false, the default is to format large numbers
  like English, with ',' as a thousand separator. If true, then '.' is
  used instead.  Note that Localize-Me options will override this behavior
  in some cases, but not all. See *Number formatting* for details.

In top of this, Localize-Me adds the following options and callbacks.

- `language` (Mandatory!) (Object): A lang label with the name of your language
  in various languages.  The game uses this when displaying the language list
  in the options.
  A value of e.g. `{'en_US': 'German', 'de_DE': 'Deutsch', 'fr_FR': 'Allemand'}`
  means that if the game is currently in English (`en_US` locale), then 'German'
  will be used, but if the game uses the `de_DE` locale, then 'Deutsch' will be
  displayed, likewise, `Allemand` is displayed if the `fr_FR` locale is used.

  If the language of the game is not in this object, then the default is to
  display the name of the language in the language itself.  So if you are e.g.
  defining the `nl_NL` locale, then `language` must at a minimum contain
  the `nl_NL` field.

- `map_file` (String or AsyncFunction): Specifies a map file URL or function.
  See the *Map File* section for details.  This field is not mandatory, but if
  if it is not set, then no patching will take place.

- `from_locale` (Mandatory!) (String): The language where you translated the
  text from.  This is used in various places and is mandatory most of the time.
  See *Translations* for details.

- `url_prefix` (String): Prefix every URL found in the map file by this.  Using
  something based on `document.currentScript.src` is advisable.  Note that
  the map file URL is not prefixed with this value.
  See the *Map file* for details.

- `missing_cb` (Function): Localize-Me calls this callback when it finds a text
  does not have a translation, or a stale one. See *Translations* for details.
- `text_filter` (Function): Localize-Me calls this callback each time a
  translation is found.  You may use it to transform the text or apply hacks
  to e.g. replace some characters by others to work around font issues.
  See *Translations* for details.

- `patch_font` (Function): This function is called as part of the PNG font
  patching process.  It is called each time a font image is loaded, and the
  callback should patch the font accordingly.
- `pre_patch_font` (AsyncFunction): If your language is selected, then this
  function is called for each font type before the first call to `patch_font`.
  This function is provided in case asynchronous operations are required (such
  as loading another image, for example), since `patch_font` cannot be
  asynchronous.


- `format_number` (Function): If set, then Localize-Me will patch the number
  formatting and use this callback to format numbers. See *Number formatting*
  for details.

- `number_locale` (String or Object): If set, then Localize-Me will patch the
  number formatting and will use this as the first parameter of
  Number.prototype.toLocaleString() to format numbers.  This default
  implementation is enough most of the time.  See *Number formatting* for
  details.

- `misc_time_function (Function): If set, then Localize-Me will patch the
  `\v[misc.time]` variable reference.  See *Time Formatting* for details.

## Translations

The game has two primary mechanisms for text internationalization.
The first one is mostly used for menus, and consists of storing strings
in a file under `assets/data/sc/lang/` named like `prefix.<locale>.json`,
where `<locale>` is the current locale.  The game sometimes refers to this
as a "lang file".

The second one is to embed so-called `LangLabel` in various JSON files all over
`assets/data/`.  These are so numerous that it is impractical to patch all of
them using CLS's PatchSteps or similar.  This is why Localize-Me loads the
translations externally and patches the JSON files in memory before handing
them to the game.

Localize-Me thus loads translation in external files that should be part of
your mod.  The translations are expected to be in so-called "pack files".
These are JSON files with a simple file format.

Each JSON file contains an object that maps each key to one string translation.

The key (internally called `file_dict_path_str`) consist of the concatenation
of the `file_path` and the `dict_path`.  The value may be of several forms,
Localize-Me internally calls this a `result`.

Localize-Me-Tools can be used to create such packs.  It can even search for
strings in the game to translate and has a command line tool to translate
the game.

### `file_path`

The `file_path` is the path of the file containing the original text to patch
with `/` as a directory separator and a path relative to the `assets/data`
directory.  Examples are thus `database.json`, `maps/rhombus-square-view.json`
or `lang/sc/gimmicks.en_US.json`.

for lang files, there are two ways to way to refers to them, since they
contains the locale in use.  If e.g. you are defining the `nl_NL` locale and
`from_locale` is set to `de_DE`, then Localize-Me will first look for
`lang/sc/gimmicks.de_DE.json` and, if nothing is found, it will look for
`lang/sc/gimmicks.nl_NL.json`.  The first one is preferred, since it makes
the job of Localize-Me-Tools easier.  The second one is historically supported
but may go away in the future.

### `dict_path`

We could describe `dict_path` as being a RFC 6901 JSON Pointer and it would
be mostly correct.  Currently, the game does not use `~` or `/` in key names,
so the escaping is currently not implemented in Localize-Me.  This difference
aside, they are the same thing.

If you know RFC 6901 JSON Pointers, you can skip the rest of this section.

A `dict_path` is a string representation of the succession of keys to follows
to access a certain LangLabel or String.  It is a list of key names to follow
in sequence, separated by spaces.  Numbers are represented in decimal.

If e.g. the game has a JSON document like:

```
{"manual":{
	"social": {
		"title": "Social menu",
		"content": [
			"Welcome to the Social menu !",
			"Here you can say "Hi !" to your friends. That's it."
		]
	},
	"circuits": {
		"title": "Circuit menu",
		"content": [
			"Welcome to the Circuit menu !",
			"Here you can exchange your CrossPoints for circuits."
		]
	}
}
```

Then the following `dict_path` would points to these strings:
`manual/social/title` would be `Social Menu`
`manual/social/content/0` would be `Welcome to the Social menu !`
`manual/circuits/content/0` would be `Welcome to the Circuit menu !`

### `file_dict_path_str`

So a `file_dict_path_str` consist of the concatenation of a `file_path`, a
`/` character and a `dict_path`.

Some actual example could are:

```
maps/cargo-ship/ship.json/entities/125/settings/event/35/message
maps/arid/interior/the-room.json/entities/40/settings/event/136/message
lang/sc/gui.en_US.json/labels/title-screen/start
lang/sc/gui.en_US.json/labels/menu/help-texts/lore/pages/1/content/2
lang/sc/gui.en_US.json/labels/menu/help-texts/equip/pages/0/content/0
```

It should be noted that, currently, every file in `assets/data` ends with the
`.json` file extension, so these references are currently not ambiguous.

### `result`

The value associated with a `file_dict_path_str` may have several forms.

The first form is deprecated, it consists of simply using a string as the
translated text.  We do not recommend this form anymore and it may be removed
in a further release.

Instead we recommend it to be an object.  It should be one of two variants.
The plain text variant or the encrapted variant.

#### Plain text variant
The plain text variant is the easiest. It may possess these fields:

- `text` (Mandatory!) (String): The translated text.
- `orig` (String): The original text, in the language specified in
  `from_locale` in the locale options.

We recommend to specify the original text that was used for the translation
because it may change during an update.  If the meaning of the original text
changes, then the translation should probably change too.

If `orig` is specified, Localize-Me will check that the original text is equal
to `orig` before using `text`.  If it differs, then Localize-Me will consider
the translation as missing.  We call this case a "stale translation".

Localize-Me-Tools can be used to detect stale translations and update them.

An example of a result can be thus simply

`{ "orig": "Hi!", "text": "Bonjour !"}`

#### Encrapted

This variant "encrypts" the translation using the original text as a key.
Its main purpose is to prevent people that do not own the game to access its
copyrighted material.  The original text is copyrighted and your translation
is probably considered as a derived work. Depending on your local jurisdiction,
it may be more legal to distribute this variant over the plain text variant.

Of course you should have consulted your lawyer first before starting your
translation project.

Anyway, this "encraption" is thus not designed to resist any attacker, since
20$ is enough to buy the game and access the key material.
Thus, this scheme is very weak and a typical example of how to NOT do
cryptography.  Please do not reproduce this if actual security is desired.
If you know a bit about cryptography, every sentence of the following
description will irk you.  Localize-Me reuses the limited outdated buggy
cryptographic library that the game uses to encrypt saves, and even
reimplements HMAC from it.

A encrapted variant may possess these two fields:

`ciphertext` (Mandatory!) (String): A base64-encoded ciphertext.
`mac` (String): A base64-encoded message authentication code.

The key K used to encrypt each variant is only calculated from the original
text in the language specified by `from_locale`.  If 's' is the original text,
then the key is defined as `MD5(encodeAsUTF8(s))`, where encodeAsUTF8 encodes
the text as UTF8.  The key is thus 128 bit long and can be used with AES-128
in CBC mode with PKCS-7 padding.  The Initialisation Vector (IV) is chosen to
be equal to the key.

`ciphertext` is thus defined as
```
encodeBase64(encryptAES_CBC(PKCS7Pad(encodeAsUTF8(text)), key=K, iv=K))
```
where `PKCS7Pad(s)` pads `s` to a multiple of 128bits,
`encryptAES_CBC(e, k, iv)` encrypt `e` with key `k` and IV `iv`
and `encodeBase64(s)` encodes `s` in base64.

`mac` is optional and used to detect stale translations (which, here,
are equivalent to using the bad decryption key).  Failed PKCS-7 checks can
already detect some stale translations, but a decrypted text ending with
byte 1 is enough to fool this, so the probability of this happening is a bit
too high.  the key K is reused

It is defined as:
`encodeBase64(HMACMD5(encodeAsUTF8(text), K))`
where `HMACMD5(s, k)` uses HMAC with MD5 to authenticate the text `s` with
key `k`.  Note that the same key K is used for both the MAC and the encryption.

Localize-Me-Tools can be used to encrypt and decrypt between this variant
and the plain text variant.

### Examples

This is an example of a packfile with plaintext results, for a `from_locale`
equal to `de_DE`:

```
{
        "lang/sc/gui.de_DE.json/labels/menu/trophies/questionMarks": {
                "orig": "???",
                "text": "???"
        },
        "lang/sc/gui.de_DE.json/labels/menu/trophies/questionMarksDesc": {
                "orig": "??????",
                "text": "??????"
        },
        "lang/sc/gui.de_DE.json/labels/options/rumble-strength/group/1": {
                "orig": "50%",
                "text": "50%"
        },
        "lang/sc/gui.de_DE.json/labels/options/rumble-strength/group/2": {
                "orig": "75%",
                "text": "75%"
        },
        "lang/sc/gui.de_DE.json/labels/options/rumble-strength/group/3": {
                "orig": "100%",
                "text": "100%"
        },
        "database.json/achievements/story-01/name": {
                "text": "Kapittel 1 ble ferdigstilt",
                "orig": "Kapitel 1 vollständig"
        },
        "database.json/achievements/story-01/description": {
                "text": "Ferdig kjedelig kapittel 1",
                "orig": "Kapitel 1 abgeschlossen."
        },
        "database.json/achievements/story-02/name": {
                "text": "Kapittel 2 ble ferdigstilt",
                "orig": "Kapitel 2 vollständig"
        },
        "database.json/achievements/story-02/description": {
                "text": "Ferdig kjedelig kapittel 2",
                "orig": "Kapitel 2 abgeschlossen."
        }
}
```

This is the same pack, with the encrapted variant:
```
{
        "database.json/achievements/story-01/description": {
                "ciphertext": "qp0JkjvXbTVjotpu+lxA6jVEd5N2DscUpaegEqHw91o=",
                "mac": "5Kzh13yPTYATN+C0bcZVaA=="
        },
        "database.json/achievements/story-01/name": {
                "ciphertext": "bNMwDn9JQJYBqfC2pmJqxtAsXYKab238c9Ffr+Tataw=",
                "mac": "BkGcweKCp9Z/Vc0eUOdNug=="
        },
        "database.json/achievements/story-02/description": {
                "ciphertext": "UoqEVzK4S1CMbLwSXOBNBIxZYXHNYiZV9CIKlG4iWtY=",
                "mac": "zmiIk8f/VnyIfzTYiUhfCA=="
        },
        "database.json/achievements/story-02/name": {
                "ciphertext": "gMQywJ8USfdxjZl+qvVgyK/T0IlyaTxYMYulKiJq8nc=",
                "mac": "iHPoRibfOjyaaaiPVQ4bmQ=="
        },
        "lang/sc/gui.de_DE.json/labels/menu/trophies/questionMarks": {
                "ciphertext": "K5v0qJ1ySBo6nM026xniKA==",
                "mac": "z1yLx3bABtr++a1PR/nkqQ=="
        },
        "lang/sc/gui.de_DE.json/labels/menu/trophies/questionMarksDesc": {
                "ciphertext": "1lMKMDCSgo62MRVM94iuUA==",
                "mac": "2JhCDF7552g+oIJLV0sIsA=="
        },
        "lang/sc/gui.de_DE.json/labels/options/rumble-strength/group/1": {
                "ciphertext": "jUO/z6wxKdxitdnzqJvIfg==",
                "mac": "FL/dPMDbb420hgK4zjwpHA=="
        },
        "lang/sc/gui.de_DE.json/labels/options/rumble-strength/group/2": {
                "ciphertext": "gNB7MSjTX0nuUmtOjTeh6w==",
                "mac": "3eTZHWWBMoYjQIIrfVqaXQ=="
        },
        "lang/sc/gui.de_DE.json/labels/options/rumble-strength/group/3": {
                "ciphertext": "DsP0NqFCn03pXWJFLBJB0g==",
                "mac": "37+MS7rMaKD/gItezKVTyA=="
        }
}
```

### Callbacks

Each time Localize-Me intercepts the game trying to load a JSON file, it
scans the file to find every LangLabel or every string of a lang file.
It then constructs a `file_dict_path_str` and tries to find the translation
of it.

If Localize-Me finds a translation, then `text_filter`, if defined, is called
with the following parameters:
`text_filter(translated_text, result)`
where `translated_text` is the translation, and `result` is the actual `result`
object found in the pack file.  It must return the text to be used instead
of `translated_text`.

If Localize-Me does not find a translation, or finds a stale translation,
then `missing_cb`, if defined, is called with the following parameters:
`missing_cb(lang_label_or_string)` where `lang_label_or_string` is either
a LangLabel, or a string from a lang file.  The default is to prefix the
original text (in the language specified by `from_locale`) with `--`.

## Map file

The game currently sports around 35000 strings to be translated.
Putting all of them inside a 10 megabyte pack file could be possible, but
not ideal for loading times.

Localize-Me thus uses an indirection in the form of a map file.

The simplest form of a map file is thus a JSON file with a single object that
maps `file_path` to URLs of packfiles.  But Localize-Me allows the mod to
define functions instead of a map file.  It even allows to define functions
instead of pack files.

The `map_file` passed to `add_locale()` parameter thus accepts an insane amount
of alternative forms.

`map_file` can be:
- an URL of a map file, that Localize-Me will load if your language is selected
- a possibly asynchronous function that Localize-Me will call if your language
  is selected.  This asynchronous function must return either
  - a Object whose format is the same as a map file
  - a Function that takes a `file_path` and that must yield either:
    - a URL to the pack file
    - a function to be used instead of the pack file.
    - a falsish object if the translation is missing.

If `url_prefix` is specified, then any URL found in a map file is prefixed
with `url_prefix`.  This is useful if you want your mod to not depends on
the name of the directory where it is installed.  If the name of your javascript
file is `postload.js`, then specifying `url_prefix` as
`document.currentScript.src.slice(0, -"postload.js".length)` should be enough
to make your mod not depend on its directory name.

Note that the location of the actual `map_file` is not prefixed by `url_prefix`,
only pack files are.

It is possible to point Localize-Me to a translated lang file instead of a pack
file.  However, this is deprecated and support for this may be removed in the
future.  Things are complicated enough already, and lang files cannot provide
stale translation checking.

If the map file is a function and it returns a function, then it is called
as follows:
`pack(file_dict_path_str, lang_label_or_string)`

where `file_dict_path_str` is defined above, and `lang_label_or_string` is
either a lang label or a string from a lang file.

### Examples

#### Big pack file

This `map_file` definition will search every translation in a big pack file:

```
map_file: () => () => "big_pack_file.json"
```

#### Splitted pack files

This `map_file` definition will point Localize-Me to an actual file.
Using something based on `document.currentScript.src` is of course preferable.

```
map_file: "assets/mods/Norway/mapfile.json"
```

An example of what `mapfile.json` could contain is:
```
{
        "lang/sc/gui.de_DE.json": "assets/mods/Norway/gui.json",
        "database.json": "assets/mods/Norway/database.json"
}
```

Using this will make your mod depends on the name of the directory where
it is installed.  One way to fix this is to use `document.currentScript.src`.

```
# this assumes that your script is called "postload.js"
const my_directory = document.currentScript.src.slice(0, -"postload.js".length);

[...]
window.localizeMe.add_locale("nl_NL", {
	[...]
	map_file: my_directory +"mapfile.json",
	url_prefix: my_directory
});
```

and `mapfile.json` would be changed to:

```
{
        "lang/sc/gui.de_DE.json": "gui.json",
        "database.json": "database.json"
}
```

#### Goofy translations

This `map_file` definition will change every text into 'TODO'.

```
map_file: () => () => () => "TODO"
```

Note that the same thing can be achieved with the `missing_cb`:

```
map_file: () => () => null,
missing_cb: () => "TODO"
```

It is also possible to alter the original text instead of replacing it:

```
map_file: () => () => null,
missing_cb: (stuff) => (stuff.en_US || stuff).replace("Lea", "Manlea")
```

but be careful to not replace var references (e.g. `\v[tmp.killedKitten]`,
`\v[lore.title.track-of-ancient]`, or the game could litteraly throw an
exception.

## Fonts

The game can use two kind of fonts. Either system fonts loaded via CSS, or
manually crafted PNG fonts that only cover parts of the ISO 8859-15
character set. Currently, the PNG fonts are used for English and German,
while the game loads system fonts for the cjk languages.

### PNG fonts

There are those pngs fonts in assets/media/font/.  There are three variants
in use:

- `tiny`, 7px, in `tiny.png`, used for very small texts.
- `small`, 13px, in `hall-fetica-small.png`, used in e.g. xeno texts
- and `bold`, 16, in `hall-fetica-bold.png`, which is the regular one used
  everywhere, from menus to conversations.

Note that separate PNG files are used for each possible color that the game
uses.  The colors are:
- for `tiny`: white, grey, red, green and yellow (the game calls that `orange`
  or even `purple`)
- for `small`: white, grey, red, green, yellow (the game still calls that
  `purple`) and orange.
- for `bold`: white, red, green, yellow (the game still calls that `purple`)
  and gray.

(Note that the `\c[3]` `\c[1]` `[c[0]` that you see in the game's text refers
 to these colors.  `\c[3]` means to pick the fourth color (the first color is
 0, white), so if the font is `bold`, this will pick the yellow color).

Therefore, to patch a font, all colors must be modified in the same way.
It is easily more practical to script this that to manually modify several
images.  Especially since the game forces every different color to have the
same character exactly at the same position.

This is why Localize-Me provides some PNG font patching support, through the
`pre_patch_font` and `patch_font` callbacks.

For each font size, the following happens:
- Localize-Me intercepts the game's request to load the font and wait for the
  PNG file to be loaded. Note that at this stage, the game has already started
  to load every font in every color available, and Localize-Me already hooked
  all of them.
- Localize-Me waits for the white font to be loaded. It then creates a `context`
  object for the font, with the following fields:
  * `char_height`, the height of the char of a font, which is 7, 13 or 16.
  * `base_image`, the loaded base image that uses the default color (white).
    note that modifying this object will not affect the game.
  * `set_base_image`, which is a function that will replace the base image
    loaded by the game by the image specified as a parameter.

- If `pre_patch_font` is specified, then Localize-Me calls it with the context
  as a parameter: `pre_patch_font(context)`.
  The callback is free to modify the context object, add fields or more, as
  this object will be reused in the following callbacks.  It is also possible
  to wait in this asynchronous function.

  In `pre_patch_font`, it is possible to call `set_base_image(image)` which
  will replace the image loaded by the game with your own image.  Your image
  must have the same dimensions as the original image and respect the format
  expected by the game.
  After `pre_patch_font` completes, the `set_base_image` field will disappear
  from the context.
- Localize-Me then hands the white font image to the game, so that it can
  extract font data from the PNG image, such as the position of each character
  and their width.  To do that, the game uses the lines that you can see below
  each character. The game loads character from left to right, top to bottom,
  starting at character number 32 (a space) and continuing up to character 255.
  The game only checks for the transparency value of the line below it to know
  the width of one character.

- Localize-Me then intercepts the next call right after the game parsed the
  font metrics. It then augments the context with these fields:

  * `get_char_pos`: a function that, given a character (as a string), returns
    an object with fields `x`, `y`, `width` and `height`, indicating where the
    character is in the image.
  * `set_char_pos`: a function that, given a character (as a string) and an
    object with fields `x`, `y`, `width` and `height`, changes the game so it
    fetches the character at the specified position instead.  Note that it is
    not possible to change the height of a single character.  Note that all
    colors share the same metrics, so it only needs to be called once for each
    font size.
  * `reserve_char`: a function that, given a canvas and a width, will find a
    free spot in the font image, allocate it and return an object with fields
    `x`, `y`, `width` and `height`. The object can then be passed to
    `set_char_pos` and drawn upon.  Calling it more than once will allocate
    multiple spots.
    If there is no free spot, this function will resize the given canvas,
    keeping its content.  This function should be called the first time
    `patch_font` is called, or else, unexpected results may occur, since
    different colors must have the same layout.
  * `recolor_from_base_image`: a function that, when called for non-base images,
    use the base image as a template and recreate it with a different color.
    It takes one canvas parameter, which is where the resulting image will be
    written.  It will return this parameter.
  * `import_from_font`: a helper function that take a canvas, an ig.Font
    and a starting character.  This function will take every character from the
    ig.Font and add them to the canvas.  It internally uses `reserve_char`
    and `set_char_pos` with consecutive characters, starting with `start_char`.
    Note that loading an ig.Font should be done in `pre_patch_font`.
  * `color`: the color of the base image.  It is white except for the
    `tiny` text.

- If `patch_base_font` is specified, then it is called as follows:
  `patch_base_font(canvas, context)`.

  canvas is a HTMLCanvas with the base font image, and context is the context
  described above.

  This function must return an image or a canvas (the game can handle both
  types) to use as a font.
  The positions of the characters can be queried and modified with
  `context.set_char_pos()` and `context.get_char_pos()`, it is possible to
  allocate new spots for characters with `context.reserve_char()` or import
  characters from a custom font with `import_from_font`.

  Note that due to the way the game works, `patch_base_font` cannot be
  asynchronous.

  For backward compatibility, if `patch_base_font` isn't defined but
  `patch_font` is, `patch_font` is called instead.

- The returned image is then handed to the game.  Then Localize-Me will
  allow the colored images to be loaded.
  if `patch_font` is defined, it is called multiple times for each colored
  image, as follows: `patch_font(canvas, context)`.

  The color of the current image is present in `context.color` as a string (css
  color).  canvas is a HTMLCanvas.  context is still the same object, but
  the `reserve_char` and `import_from_font` are no longer available.

  This function should return an image or a canvas (the game can handle both
  types). The caller is advised to patch
  each image in the same way, possibly by calculating what needs to be done
  in `patch_base_font` and replicating it for each image.

  If `patch_font` isn't defined but `patch_base_font` or `pre_patch_font`
  is defined, then a default implementation that simply uses
  `context.recolor_from_base_image()` is used instead.

- Each time `patch_font` returns, Localize-Me hands out the colored image to
  the game.

Note that font patching happens very early in the game bootstrapping process.
Therefore, most of the game modules will probably be unavailable.

Note that when using `import_from_font`, the ig.Font should be already loaded
when `patch_font` is called, therefore it should be loaded in `pre_patch_font`.
The following loading sequence is suggested:
```
	pre_patch_font: async context => {
		if (context.char_height === 13) {
			const font = new ig.Font("path/to/font/image.png", 13);
			context.my_font = font;
			return new Promise(resolve => {
				const old_onload = font.onload;
				font.onload = (a...) => {
					old_onload.apply(font, a);
					resolve();
				};
			});
		}
	},
	patch_base_font: (image, context) => {
		if (context.char_height === 13) {
			// new characters will be available starting at \u0100
			context.import_from_font(image, context.my_font,
						 "\u0100");
		}
		return image;
	},
```

### System fonts

The game defines the system fonts in `assets/impact/page/css/style.css` with
font-face CSS definitions.  Localize-Me does not handle adding system fonts.
Modifying document.style should be doable with a few lines of code.

## Number formatting

Localize-Me provides some methods to format numbers according to the current
locale. But note that it does not apply to every numbers used by the game.
For example, Localize-Me does not modify the formatting of damage numbers,
because the game currently makes this impractical to patch.

Still, Localize-Me supports formatting numbers specified by variable
substitions (e.g. `\v[misc.localNum.424242]`) or the numbers from the statistics
menu.  It is configurable through the `number_locale` option and
`format_number` callback.
Specifying any of these two will enable number formatting localization.

If `number_locale` is specified, then Localize-Me will format numbers using
a default implementation that relies on `Number.prototype.toLocaleString`.
This method is provided by the browser (in nwjs case, it's Chromium) and
is specified in the ES Internationalization API as an extention to ES5.
The first parameter of `toLocaleString` specifies the locale to be used,
and Localize-Me's implementation will shamelessly uses the value of
`number_locale` for it. Beware that `toLocaleString` uses a locale format
that differs from the game, since they are based on html language tags.

Beware that different browser may return different results. For example,
browsers may return different Unicode strings that are rendered the same way,
or in a very similar way.  It is also your responsibility to ensure that the
resulting string can be rendered by the game. For example, the `fr-FR` locale
is known to return various kind of non-breaking spaces depending on the
browser, and the game is, by default, not able to handle those.

To provide for greater control, Localize-me proposes the `format_number`
callback, which is called as follows:
`format_number(number, fractional_precision, unit, reference)` and must return
a string.

While number is the number that must be formatted, `fractional_precision`
indicates how many digits must be present after the "comma", and
`unit` is the unit that must be appended to the number, if any.
Currently, this may be null, '%', 'm' or 'km'.

`reference` is given only if `number_locale` is specified.  In this case,
Localize-Me will render the number with its default implementation then
pass the result in this parameter. Thus, it is possible to apply small
modifications to this value and return it.

## Time Formatting

The game does not display the current time, except in one location:
The description of the "Golden Revolver" item (327).

It reads "It's \v[misc.time]", and the game currently hardcodes `\v[misc.time]`
as being the current time, unless the current hour is between 11 and 13
(inclusive), in which case it displays "It's High Noon".
(As of Jan 2019, this is currently a bug, because at noon, the text
 "It's It's High Noon" will be displayed as a result.)

If the `misc_time_function` option is given, Localize-me will replace this
hardcoded implementation by the given function.  It should return the
translation of this text.

An implementation could be:
```
misc_time_function: () => {
	const date = new Date();
	if (date.getHours() >= 11 && date.getHours() <= 13)
		return "Zwölf Uhr mittags";
	return `${date.getHours()}:${date.getMinutes()}`;
},
```
