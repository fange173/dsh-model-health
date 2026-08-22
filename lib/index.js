import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { MAX_TIMER_DELAY_MS, deadline, timeoutOf } from "@deepseek-ai/dsh-timeout";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region ../../../vendor/cosmokit/lib/index.js
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject(data) {
	return data && typeof data === "object" && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
function filterKeys(object, filter) {
	return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
function mapValues(object, transform) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Pick selected keys from an object, optionally including `undefined` values. */
function pick(source, keys, forced) {
	if (!keys) return { ...source };
	const result = {};
	for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
	return result;
}
/** Test values using `instanceof` with a `toStringTag` fallback. */
function is(type, value) {
	if (arguments.length === 1) return (value) => is(type, value);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
/** Binary source detection and base64/hex conversion helpers. */
var Binary;
(function(Binary) {
	Binary.is = isArrayBufferLike;
	Binary.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	Binary.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	Binary.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	Binary.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	Binary.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
Binary.fromBase64;
Binary.toBase64;
Binary.fromHex;
Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
function clone(source, refs = /* @__PURE__ */ new Map()) {
	if (!source || typeof source !== "object") return source;
	if (is("Date", source)) return new Date(source.valueOf());
	if (is("RegExp", source)) return new RegExp(source.source, source.flags);
	if (isArrayBufferLike(source)) return source.slice(0);
	if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	const cached = refs.get(source);
	if (cached) return cached;
	if (Array.isArray(source)) {
		const result = [];
		refs.set(source, result);
		source.forEach((value, index) => {
			result[index] = Reflect.apply(clone, null, [value, refs]);
		});
		return result;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
		Reflect.defineProperty(result, key, descriptor);
	}
	return result;
}
/** Deeply compare arrays, dates, regexps, buffers, and plain object fields. */
function deepEqual(a, b, strict) {
	if (a === b) return true;
	if (!strict && isNullable(a) && isNullable(b)) return true;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object") return false;
	if (!a || !b) return false;
	function check(test, then) {
		return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
	}
	return check(Array.isArray, (a, b) => a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
		if (a.byteLength !== b.byteLength) return false;
		const viewA = new Uint8Array(a);
		const viewB = new Uint8Array(b);
		for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
		return true;
	}) ?? Object.keys({
		...a,
		...b
	}).every((key) => deepEqual(a[key], b[key], strict));
}
/** Time constants plus parsing and formatting helpers. */
var Time;
(function(Time) {
	Time.millisecond = 1;
	Time.second = 1e3;
	Time.minute = Time.second * 60;
	Time.hour = Time.minute * 60;
	Time.day = Time.hour * 24;
	Time.week = Time.day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	Time.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	Time.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / Time.minute - offset) / 1440);
	}
	Time.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * Time.day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * Time.minute);
	}
	Time.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * Time.week || 0) + (parseFloat(capture[2]) * Time.day || 0) + (parseFloat(capture[3]) * Time.hour || 0) + (parseFloat(capture[4]) * Time.minute || 0) + (parseFloat(capture[5]) * Time.second || 0);
	}
	Time.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	Time.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= Time.day - Time.hour / 2) return Math.round(ms / Time.day) + "d";
		else if (abs >= Time.hour - Time.minute / 2) return Math.round(ms / Time.hour) + "h";
		else if (abs >= Time.minute - Time.second / 2) return Math.round(ms / Time.minute) + "m";
		else if (abs >= Time.second) return Math.round(ms / Time.second) + "s";
		return ms + "ms";
	}
	Time.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	Time.toDigits = toDigits;
	function template(template, time = /* @__PURE__ */ new Date()) {
		return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	Time.template = template;
})(Time || (Time = {}));
//#endregion
//#region ../../../vendor/schemastery/lib/index.mjs
const kSchema = Symbol.for("schemastery");
const kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
	options;
	name = "ValidationError";
	constructor(message, options) {
		let prefix = "$";
		for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
		else if (typeof segment === "number") prefix += "[" + segment + "]";
		else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
		if (prefix.startsWith(".")) prefix = prefix.slice(1);
		super((prefix === "$" ? "" : `${prefix} `) + message);
		this.options = options;
	}
	static is(error) {
		return !!error?.[kValidationError];
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
const Schema = function(options) {
	const schema = function(data, options = {}) {
		return Schema.resolve(data, schema, options)[0];
	};
	if (options.refs) {
		const refs = mapValues(options.refs, (options) => new Schema(options));
		const getRef = (uid) => refs[uid];
		for (const key in refs) {
			const options = refs[key];
			options.sKey = getRef(options.sKey);
			options.inner = getRef(options.inner);
			options.list = options.list && options.list.map(getRef);
			options.dict = options.dict && mapValues(options.dict, getRef);
		}
		return refs[options.uid];
	}
	Object.assign(schema, options);
	if (typeof schema.callback === "string") try {
		schema.callback = new Function("return " + schema.callback)();
	} catch {}
	Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
	Object.setPrototypeOf(schema, Schema.prototype);
	schema.meta ||= {};
	schema.toString = schema.toString.bind(schema);
	return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
	return {
		version: 1,
		vendor: "schemastery",
		validate: (value) => {
			try {
				return { value: Schema.resolve(value, this, {})[0] };
			} catch (error) {
				if (ValidationError.is(error)) return { issues: [{
					message: error.message,
					path: error.options.path
				}] };
				throw error;
			}
		}
	};
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
	if (globalThis.__schemastery_refs__) {
		globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
		return this.uid;
	}
	globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
	globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
	const result = {
		uid: this.uid,
		refs: globalThis.__schemastery_refs__
	};
	globalThis.__schemastery_refs__ = void 0;
	return result;
};
Schema.prototype.set = function set(key, value) {
	this.dict[key] = value;
	return this;
};
Schema.prototype.push = function push(value) {
	this.list.push(value);
	return this;
};
function mergeDesc(original, messages) {
	const result = typeof original === "string" ? { "": original } : { ...original };
	for (const locale in messages) {
		const value = messages[locale];
		if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
		else if (typeof value === "string") result[locale] = value;
	}
	return result;
}
function getInner(value) {
	return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
	return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
	const schema = Schema(this);
	const desc = mergeDesc(schema.meta.description, messages);
	if (Object.keys(desc).length) schema.meta.description = desc;
	if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
		return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
	});
	if (schema.list) schema.list = schema.list.map((inner, index) => {
		return inner.i18n(mapValues(messages, (data = {}) => {
			if (Array.isArray(getInner(data))) return getInner(data)[index];
			if (Array.isArray(data)) return data[index];
			return extractKeys(data);
		}));
	});
	if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
		if (getInner(data)) return getInner(data);
		return extractKeys(data);
	}));
	if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
	return schema;
};
Schema.prototype.extra = function extra(key, value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
};
for (const key of [
	"required",
	"disabled",
	"collapse",
	"hidden",
	"loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.deprecated = function deprecated() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "deprecated",
		type: "danger"
	});
	return schema;
};
Schema.prototype.experimental = function experimental() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "experimental",
		type: "warning"
	});
	return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
	const schema = Schema(this);
	const pattern = pick(regexp, ["source", "flags"]);
	schema.meta = {
		...schema.meta,
		pattern
	};
	return schema;
};
Schema.prototype.simplify = function simplify(value) {
	if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
		return result;
	} else if (this.type === "array" || this.type === "tuple") {
		const result = [];
		value.forEach((value, index) => {
			const schema = this.type === "array" ? this.inner : this.list[index];
			const item = schema ? schema.simplify(value) : value;
			result.push(item);
		});
		return result;
	} else if (this.type === "intersect") {
		const result = {};
		for (const item of this.list) Object.assign(result, item.simplify(value));
		return result;
	} else if (this.type === "union") for (const schema of this.list) try {
		Schema.resolve(value, schema, {});
		return schema.simplify(value);
	} catch {}
	return value;
};
Schema.prototype.toString = function toString(inline) {
	return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		role,
		extra
	};
	return schema;
};
for (const key of [
	"default",
	"link",
	"comment",
	"description",
	"max",
	"min",
	"step"
]) Object.assign(Schema.prototype, { [key](value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
const resolvers = {};
Schema.extend = function extend(type, resolve) {
	resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
	if (!schema) return [data];
	if (options.ignore?.(data, schema)) return [data];
	if (isNullable(data) && schema.type !== "lazy") {
		if (schema.meta.required) throw new ValidationError(`missing required value`, options);
		let current = schema;
		let fallback = schema.meta.default;
		while (current?.type === "intersect" && isNullable(fallback)) {
			current = current.list[0];
			fallback = current?.meta.default;
		}
		if (isNullable(fallback)) return [data];
		data = clone(fallback);
	}
	const callback = resolvers[schema.type];
	if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
	try {
		return callback(data, schema, options, strict);
	} catch (error) {
		if (!schema.meta.loose) throw error;
		return [schema.meta.default];
	}
};
Schema.from = function from(source) {
	if (isNullable(source)) return Schema.any();
	else if ([
		"string",
		"number",
		"boolean"
	].includes(typeof source)) return Schema.const(source).required();
	else if (source[kSchema]) return source;
	else if (typeof source === "function") switch (source) {
		case String: return Schema.string().required();
		case Number: return Schema.number().required();
		case Boolean: return Schema.boolean().required();
		case Function: return Schema.function().required();
		default: return Schema.is(source).required();
	}
	else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
	const toJSON = () => {
		if (!schema.inner[kSchema]) {
			schema.inner = schema.builder();
			schema.inner.meta = {
				...schema.meta,
				...schema.inner.meta
			};
		}
		return schema.inner.toJSON();
	};
	const schema = new Schema({
		type: "lazy",
		builder,
		inner: { toJSON }
	});
	return schema;
};
Schema.natural = function natural() {
	return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
	return Schema.number().step(.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
	return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
		const date = new Date(value);
		if (isNaN(+date)) throw new ValidationError(`invalid date "${value}"`, options);
		return date;
	}, true)]);
};
Schema.regExp = function regExp(flag = "") {
	return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
		try {
			return new RegExp(value, flag);
		} catch (e) {
			throw new ValidationError(e.message, options);
		}
	}, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
	return Schema.union([
		Schema.is(ArrayBuffer),
		Schema.is(SharedArrayBuffer),
		Schema.transform(Schema.any(), (value, options) => {
			if (Binary.isSource(value)) return Binary.fromSource(value);
			throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
		}, true),
		...encoding ? [Schema.transform(Schema.string(), (value, options) => {
			try {
				return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
			} catch (e) {
				throw new ValidationError(e.message, options);
			}
		}, true)] : []
	]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
	if (!schema.inner[kSchema]) {
		schema.inner = schema.builder();
		schema.inner.meta = {
			...schema.meta,
			...schema.inner.meta
		};
	}
	return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
	return [data];
});
Schema.extend("never", (data, _, options) => {
	throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
	if (deepEqual(data, value)) return [value];
	throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
	const { max = Infinity, min = -Infinity } = meta;
	if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
	if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
	if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
	if (meta.pattern) {
		const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
		if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
	}
	checkWithinRange(data.length, meta, "string length", options);
	return [data];
});
function decimalShift(data, digits) {
	const str = data.toString();
	if (str.includes("e")) return data * Math.pow(10, digits);
	const index = str.indexOf(".");
	if (index === -1) return data * Math.pow(10, digits);
	const frac = str.slice(index + 1);
	const integer = str.slice(0, index);
	if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
	return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
	step = Math.abs(step);
	if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
	const index = step.toString().indexOf(".");
	const digits = step.toString().slice(index + 1).length;
	return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
	if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
	checkWithinRange(data, meta, "number", options);
	const { step } = meta;
	if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
	return [data];
});
Schema.extend("boolean", (data, _, options) => {
	if (typeof data === "boolean") return [data];
	throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
	let value = 0, keys = [];
	if (typeof data === "number") {
		value = data;
		for (const key in bits) if (data & bits[key]) keys.push(key);
	} else if (Array.isArray(data)) {
		keys = data;
		for (const key of keys) {
			if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
			if (key in bits) value |= bits[key];
		}
	} else throw new ValidationError(`expected number or array but got ${data}`, options);
	if (value === meta.default) return [value];
	return [value, keys];
});
Schema.extend("function", (data, _, options) => {
	if (typeof data === "function") return [data];
	throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
	if (typeof constructor === "function") {
		if (data instanceof constructor) return [data];
		throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
	} else {
		if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
		let prototype = Object.getPrototypeOf(data);
		while (prototype) {
			if (prototype.constructor?.name === constructor) return [data];
			prototype = Object.getPrototypeOf(prototype);
		}
		throw new ValidationError(`expected ${constructor} but got ${data}`, options);
	}
});
function property(data, key, schema, options) {
	try {
		const [value, adapted] = Schema.resolve(data[key], schema, {
			...options,
			path: [...options.path || [], key]
		});
		if (adapted !== void 0) data[key] = adapted;
		return value;
	} catch (e) {
		if (!options?.autofix) throw e;
		delete data[key];
		return schema.meta.default;
	}
}
Schema.extend("array", (data, { inner, meta }, options) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
	return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in data) {
		let rKey;
		try {
			rKey = Schema.resolve(key, sKey, options)[0];
		} catch (error) {
			if (strict) continue;
			throw error;
		}
		result[rKey] = property(data, key, inner, options);
		data[rKey] = data[key];
		if (key !== rKey) delete data[key];
	}
	return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	const result = list.map((inner, index) => property(data, index, inner, options));
	if (strict) return [result];
	result.push(...data.slice(list.length));
	return [result];
});
function merge(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge(result, data);
	return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
	const messages = [];
	for (const inner of list) try {
		return Schema.resolve(data, inner, options, strict);
	} catch (error) {
		messages.push(error);
	}
	throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
	if (!list.length) return [data];
	let result;
	for (const inner of list) {
		const value = Schema.resolve(data, inner, options, true)[0];
		if (isNullable(value)) continue;
		if (isNullable(result)) result = value;
		else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		else if (typeof value === "object") merge(result ??= {}, value);
		else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject(data)) merge(result, data);
	return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
	const [result, adapted = data] = Schema.resolve(data, inner, options, true);
	if (preserve) return [callback(result)];
	else return [callback(result), callback(adapted)];
});
const formatters = {};
function defineMethod(name, keys, format) {
	formatters[name] = format;
	Object.assign(Schema, { [name](...args) {
		const schema = new Schema({ type: name });
		keys.forEach((key, index) => {
			switch (key) {
				case "sKey":
					schema.sKey = args[index] ?? Schema.string();
					break;
				case "inner":
					schema.inner = Schema.from(args[index]);
					break;
				case "list":
					schema.list = args[index].map(Schema.from);
					break;
				case "dict":
					schema.dict = mapValues(args[index], Schema.from);
					break;
				case "bits":
					schema.bits = {};
					for (const key in args[index]) {
						if (typeof args[index][key] !== "number") continue;
						schema.bits[key] = args[index][key];
					}
					break;
				case "callback": {
					const callback = schema.callback = args[index];
					callback["toJSON"] ||= () => callback.toString();
					break;
				}
				case "constructor": {
					const constructor = schema.constructor = args[index];
					if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
					break;
				}
				default: schema[key] = args[index];
			}
		});
		if (name === "object" || name === "dict") schema.meta.default = {};
		else if (name === "array" || name === "tuple") schema.meta.default = [];
		else if (name === "bitset") schema.meta.default = 0;
		return schema;
	} });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
	if (typeof constructor === "function") return constructor.name;
	else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
	if (Object.keys(dict).length === 0) return "{}";
	return `{ ${Object.entries(dict).map(([key, inner]) => {
		return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
	}).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
	const result = list.map(({ toString: format }) => format()).join(" | ");
	return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
	return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
	"inner",
	"callback",
	"preserve"
], ({ inner }, isInner) => inner.toString(isInner));
//#endregion
//#region lib/types/filter.js
/**
* Runtime enabled-filter for model probes. The user's settings click default
* to "everything enabled"; turning a provider or an individual model off here
* both hides it from the panel and stops probing it. Semantics are denylist
* based, so a newly registered model (absent from the denylists) is enabled
* by default — matching the "first install probes all, new models auto-enable"
* behaviour. Thread-safe enough for a single-threaded host: the filter is
* immutable and replaced wholesale on toggle.
* @module dsh-model-health
*/
/** Probe pairs as opaque keys. */
function targetKey(provider, model) {
	return `${provider}/${model}`;
}
/**
* Validate an unknown value (a POST body, a loaded JSON document) into a
* filter: only string keys survive, empties drop, and the lists are capped so
* the persisted document stays bounded no matter what wrote it last.
* @param value - the untrusted value.
* @returns a filter value safe to store and serve.
*/
function sanitizeFilterInput(value) {
	if (value === null || typeof value !== "object") return {};
	const raw = value;
	const providers = sanitizeList(raw.disabledProviders);
	const models = sanitizeList(raw.disabledModels);
	return {
		...providers.length > 0 ? { disabledProviders: providers } : {},
		...models.length > 0 ? { disabledModels: models } : {}
	};
}
/** Keep only bounded, non-empty, de-duplicated strings from an unknown list. */
function sanitizeList(value) {
	if (!Array.isArray(value)) return [];
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const entry of value) {
		if (out.length >= 256) break;
		if (typeof entry !== "string" || entry.length === 0 || entry.length > 200) continue;
		if (seen.has(entry)) continue;
		seen.add(entry);
		out.push(entry);
	}
	return out;
}
/** Whether one provider/model pair passes the filter (turned on). */
function isModelEnabled(filter, provider, model) {
	if (filter.disabledProviders?.includes(provider)) return false;
	return !filter.disabledModels?.includes(targetKey(provider, model));
}
/**
* Apply a filter over a set of enumerated probe targets, keeping only those the
* user has not disabled, in input order.
* @param targets - the full registered catalog.
* @param filter - the user's enabled selection.
* @returns the subset to probe.
*/
function filterTargets(targets, filter) {
	return targets.filter((target) => isModelEnabled(filter, target.provider, target.model));
}
//#endregion
//#region lib/types/http.js
/**
* Local HTTP status route for the model-health plugin. Serves the current
* snapshot, retained probe rounds, full model catalog, and the enabled filter
* as JSON for a same-origin browser consumer; `?refresh=1` runs a full probe
* round before answering. A `POST` to the same path updates the enabled-model
* selection (from the browser settings panel) and returns the accepted filter.
* @module dsh-model-health
*/
/** Stable machine code a consumer can match on a structured route error. */
const ROUTE_ERROR_CODE = "MODEL_HEALTH_ROUTE";
const JSON_HEADERS = {
	"content-type": "application/json; charset=utf-8",
	"cache-control": "no-store"
};
/** Validate that an unknown value is a plausible enabled-filter body. */
function parseFilterBody(value) {
	return sanitizeFilterInput(value);
}
/** Write one JSON status/error pair onto the response; HEAD mirrors GET's Content-Length with an empty body. */
function writeJson(res, status, body, head) {
	res.writeHead(status, head ? {
		...JSON_HEADERS,
		"content-length": Buffer.byteLength(body)
	} : JSON_HEADERS);
	res.end(head ? void 0 : body);
}
/** Read the request body as text (bounded), for POST filter sync. */
function readRequestBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 64 * 1024) {
				req.destroy();
				reject(/* @__PURE__ */ new Error("request body too large"));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}
function buildView(deps) {
	return {
		config: deps.statusConfig,
		snapshot: deps.store.snapshot(),
		history: deps.store.history(),
		catalog: deps.store.catalog(),
		filter: deps.store.filter()
	};
}
/**
* Build the route handler. GET/HEAD on a store with no data runs a probe round
* so early page visits see real results; `?refresh=1` forces one. POST reads a
* filter body, applies it, and answers with the accepted filter. A failed GET
* round answers with the last known snapshot rather than an error — only a
* genuinely thrown servo failure is a 500.
* @param deps - store, round runner, and echoed config.
* @returns the web-server route handler.
*/
function createModelHealthRouteHandler(deps) {
	return (req, res) => {
		const head = req.method === "HEAD";
		const method = head ? "GET" : req.method ?? "GET";
		if (method !== "GET" && method !== "POST") {
			res.writeHead(405, {
				...JSON_HEADERS,
				"allow": "GET, HEAD, POST"
			});
			res.end(JSON.stringify({ error: {
				code: "METHOD_NOT_ALLOWED",
				message: "Use GET, HEAD, or POST."
			} }));
			return;
		}
		if (method === "POST") return (async () => {
			const filter = await updatePost(deps, req);
			if (res.headersSent) return;
			writeJson(res, 200, JSON.stringify(filter), head);
		})().catch((error) => {
			if (res.headersSent) return;
			const message = error instanceof Error ? error.message : String(error);
			writeJson(res, 400, JSON.stringify({ error: {
				code: ROUTE_ERROR_CODE,
				message
			} }), head);
		});
		const refresh = new URL(req.url ?? "/", "http://model-health.invalid").searchParams.get("refresh") === "1";
		return (async () => {
			if (refresh || deps.store.isEmpty()) await deps.monitor.runNow();
			writeJson(res, 200, JSON.stringify(buildView(deps)), head);
		})().catch((error) => {
			if (res.headersSent) return;
			const message = error instanceof Error ? error.message : String(error);
			writeJson(res, 500, JSON.stringify({ error: {
				code: ROUTE_ERROR_CODE,
				message
			} }), head);
		});
	};
}
/** Apply a POSTed filter body and echo the accepted selection. */
async function updatePost(deps, req) {
	const raw = await readRequestBody(req);
	let parsed;
	try {
		parsed = raw.length === 0 ? {} : JSON.parse(raw);
	} catch (error) {
		throw new Error(`invalid JSON body: ${error instanceof Error ? error.message : String(error)}`);
	}
	const filter = parseFilterBody(parsed);
	deps.monitor.setFilter(filter);
	await deps.monitor.runNow();
	return filter;
}
/**
* Register the status route on the host web server whenever one exists, and a
* POST side-effect route at the same path if requested. See {@link registerModelHealthRoute}.
*/
function registerModelHealthRoute(ctx, deps) {
	let mounted;
	let active = true;
	const mount = () => {
		if (!active) return;
		const webServer = ctx.get("webServer");
		if (webServer === void 0) return;
		mounted = webServer.register({
			kind: "exact",
			path: deps.path,
			handler: createModelHealthRouteHandler(deps)
		});
	};
	mount();
	ctx.effect(() => ctx.on("internal/service", (name) => {
		if (name === "webServer") mount();
	}), "model-health: webServer watch");
	return () => {
		active = false;
		mounted?.();
		mounted = void 0;
	};
}
//#endregion
//#region lib/types/probe.js
/**
* Probe execution: enumerate the currently registered provider/model routes,
* run one bounded minimal round-trip per model, and classify the outcome.
* @module dsh-model-health
*/
var __addDisposableResource = function(env, value, async) {
	if (value !== null && value !== void 0) {
		if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
		var dispose, inner;
		if (async) {
			if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
			dispose = value[Symbol.asyncDispose];
		}
		if (dispose === void 0) {
			if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
			dispose = value[Symbol.dispose];
			if (async) inner = dispose;
		}
		if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
		if (inner) dispose = function() {
			try {
				inner.call(this);
			} catch (e) {
				return Promise.reject(e);
			}
		};
		env.stack.push({
			value,
			dispose,
			async
		});
	} else if (async) env.stack.push({ async: true });
	return value;
};
var __disposeResources = (function(SuppressedError) {
	return function(env) {
		function fail(e) {
			env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
			env.hasError = true;
		}
		var r, s = 0;
		function next() {
			while (r = env.stack.pop()) try {
				if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
				if (r.dispose) {
					var result = r.dispose.call(r.value);
					if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) {
						fail(e);
						return next();
					});
				} else s |= 1;
			} catch (e) {
				fail(e);
			}
			if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
			if (env.hasError) throw env.error;
		}
		return next();
	};
})(typeof SuppressedError === "function" ? SuppressedError : function(error, suppressed, message) {
	var e = new Error(message);
	return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
/** Whether a stream chunk carries generated content (text, reasoning, or tool args). */
function isTokenChunk(chunk) {
	switch (chunk.type) {
		case "text-delta":
		case "reasoning-delta": return chunk.text !== "";
		case "tool-call-delta": return chunk.argumentsDelta !== "" || chunk.name !== void 0;
		default: return false;
	}
}
/** Capability-owned timeout code stamped on each probe's deadline (distinct from the 'PROBE_TIMEOUT' wire result code it causes). */
const PROBE_DEADLINE_CODE = "MODEL_HEALTH_PROBE";
/**
* Enumerate every model the runtime currently advertises, from the registered
* provider routes and each adapter's advisory catalog. A provider whose
* catalog cannot be listed is skipped with a diagnostic, never fatal. When
* `providers` or `models` is set, targets outside those whitelists are dropped.
* @param ctx - global context owning the llm runtime.
* @param providers - provider ids to keep; undefined keeps all.
* @param models - `provider/model` pairs to keep; undefined keeps all within the provider filter.
* @returns probe targets in provider-then-catalog order.
*/
async function listProbeTargets(ctx, providers = void 0, models = void 0) {
	const providerSet = providers !== void 0 && providers.length > 0 ? new Set(providers) : void 0;
	const modelSet = models !== void 0 && models.length > 0 ? new Set(models) : void 0;
	const targets = [];
	for (const provider of ctx.llm.listProviders()) {
		if (providerSet !== void 0 && !providerSet.has(provider.id)) continue;
		let modelsInfo;
		try {
			modelsInfo = await ctx.llm.listModels(provider.id);
		} catch (error) {
			ctx.logger.warn(`model-health: could not list models for provider "${provider.id}": ${renderThrown(error)}`);
			continue;
		}
		for (const model of modelsInfo) {
			if (modelSet !== void 0 && !modelSet.has(`${provider.id}/${model.id}`)) continue;
			targets.push({
				provider: provider.id,
				model: model.id,
				name: model.name
			});
		}
	}
	return targets;
}
/**
* Run one bounded minimal round-trip against a model and classify it into an
* `ok` result with latency, or a failure with provider facts. The deadline
* only notifies through the request signal; the adapter owns closing the
* stream when it aborts.
* @param ctx - global context owning the llm runtime.
* @param target - provider/model route to probe.
* @param options - timing and request facts.
* @returns the detached, single-probe outcome.
*/
async function probeModel(ctx, target, options) {
	const env_1 = {
		stack: [],
		error: void 0,
		hasError: false
	};
	try {
		const startedAt = Date.now();
		const checkedAt = new Date(startedAt).toISOString();
		let ttftMs;
		let totalMs;
		let usage;
		let error;
		let ok = false;
		let sawDelta = false;
		const signal = __addDisposableResource(env_1, deadline(void 0, options.probeTimeoutMs, PROBE_DEADLINE_CODE), false).signal;
		try {
			const request = {
				provider: target.provider,
				model: target.model,
				messages: [createUserMessage({
					source: { kind: "user" },
					content: [{
						type: "text",
						text: options.probePrompt
					}]
				})],
				maxTokens: options.probeMaxTokens,
				signal
			};
			for await (const chunk of ctx.llm.stream(request)) {
				if (isTokenChunk(chunk)) sawDelta = true;
				if (ttftMs === void 0 && isTokenChunk(chunk)) ttftMs = Date.now() - startedAt;
				if (chunk.type === "usage") {
					usage = {
						inputTokens: chunk.usage.inputTokens,
						outputTokens: chunk.usage.outputTokens
					};
					continue;
				}
				if (chunk.type !== "finish") continue;
				totalMs = Date.now() - startedAt;
				switch (chunk.reason.kind) {
					case "error":
					case "aborted":
						error = probeFailure(chunk.reason.failure, signal, options.probeTimeoutMs);
						break;
					default: ok = true;
				}
				break;
			}
			if (totalMs === void 0) {
				totalMs = Date.now() - startedAt;
				error = probeFailure(void 0, signal, options.probeTimeoutMs) ?? {
					code: "INCOMPLETE_STREAM",
					message: "the provider stream ended without a finish chunk"
				};
			}
		} catch (caught) {
			totalMs = Date.now() - startedAt;
			error = probeFailure(void 0, signal, options.probeTimeoutMs) ?? {
				code: "PROBE_EXCEPTION",
				message: renderThrown(caught)
			};
		}
		if (!ok && sawDelta && error?.code === "PROBE_TIMEOUT") {
			ok = true;
			error = void 0;
		}
		return {
			provider: target.provider,
			model: target.model,
			name: target.name,
			checkedAt,
			ok,
			...ttftMs === void 0 ? {} : { ttftMs },
			totalMs,
			...usage === void 0 ? {} : { usage },
			...error === void 0 ? {} : { error }
		};
	} catch (e_1) {
		env_1.error = e_1;
		env_1.hasError = true;
	} finally {
		__disposeResources(env_1);
	}
}
/**
* Translate a probe's terminal failure, preferring the local timeout when its
* deadline fired over whatever the adapter reported.
* @param failure - normalized adapter failure, when one was emitted.
* @param signal - the probe's deadline-fused signal.
* @param timeoutMs - the deadline that may have elapsed.
* @returns a stable failure, or `undefined` when neither applies.
*/
function probeFailure(failure, signal, timeoutMs) {
	if (timeoutOf(signal, "MODEL_HEALTH_PROBE") !== void 0) return {
		code: "PROBE_TIMEOUT",
		message: `the model probe exceeded ${timeoutMs} ms`
	};
	if (failure === void 0) return void 0;
	return {
		code: failure.code,
		message: failure.message,
		...failure.status === void 0 ? {} : { status: failure.status }
	};
}
/** Render an unknown throw for process-local diagnostics. */
function renderThrown(value) {
	return value instanceof Error ? value.message : String(value);
}
/**
* Run `run` over every item with at most `limit` concurrent executions,
* preserving input order in the returned results.
* @param items - inputs to process.
* @param limit - positive concurrency cap.
* @param run - one item's asynchronous work.
* @returns one result per item, in input order.
*/
async function runWithConcurrency(items, limit, run) {
	const results = new Array(items.length);
	const slots = items.entries();
	const take = () => {
		const next = slots.next();
		return next.done === true ? void 0 : {
			index: next.value[0],
			item: next.value[1]
		};
	};
	const worker = async () => {
		while (true) {
			const slot = take();
			if (slot === void 0) return;
			results[slot.index] = await run(slot.item);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results.map((value, index) => {
		/* v8 ignore next 2 -- every slot resolves before Promise.all returns, so an empty slot means the loop above was bypassed. */
		if (value === void 0) throw new Error(`model-health: probe ${index} produced no result`);
		return value;
	});
}
//#endregion
//#region lib/types/store.js
/**
* In-memory latest-results store for model probes. Holds one result per
* registered provider/model pair, reconciled whenever the provider topology
* changes, and derives snapshots in a stable order.
* @module dsh-model-health
*/
/**
* Join a provider/model pair into one opaque store key.
* @param provider - provider id.
* @param model - model id within that provider.
* @returns one string key unique across the runtime's registered routes.
*/
function modelKey(provider, model) {
	return `${provider}\u0000${model}`;
}
/** Process-local holder of the latest per-model probe results and retained rounds. */
var ModelHealthStore = class {
	historyLimit;
	results = /* @__PURE__ */ new Map();
	rounds = [];
	lastProbeAt;
	/** Every registered provider/model observed in the most recent round. */
	catalogTargets = [];
	/** The current enabled-model selection; empty means everything on. */
	enabledFilter = {};
	/**
	* @param historyLimit - rounds to retain for trend rendering; `0` retains
	* nothing, so the store stays exactly the latest-results map it was before
	* history existed.
	*/
	constructor(historyLimit = 0) {
		this.historyLimit = historyLimit;
	}
	/**
	* Refresh the full registered catalog observed this round. It is the same
	* first-probe-target enumeration the monitor probes, kept unfiltered so the
	* settings checkbox list can render every model with its enabled state.
	* @param targets - every registered provider/model, in provider-then-catalog order.
	*/
	setCatalog(targets) {
		this.catalogTargets = [...targets];
	}
	/**
	* Replace the user's enabled-model selection. Disabled models are filtered
	* out of the rendered snapshot on the next `snapshot()`/`catalog()` call.
	* @param filter - the new selection, or the empty filter to enable all.
	*/
	setFilter(filter) {
		this.enabledFilter = filter;
	}
	/**
	* Merge retained rounds from a durable source (a file loaded at plugin
	* start) into the live history. Merging — not replacing — keeps any round
	* that already ran while the async load was in flight, and re-sorting by
	* timestamp restores oldest-first order no matter which side produced a
	* given round. Duplicate timestamps collapse (two rounds inside one
	* millisecond cannot happen: every round waits on real network probes).
	* @param rounds - retained rounds from storage, oldest first.
	*/
	seedHistory(rounds) {
		const limit = Math.max(0, this.historyLimit);
		const seen = /* @__PURE__ */ new Set();
		const merged = [...this.rounds, ...rounds ?? []].filter((round) => {
			if (seen.has(round.checkedAt)) return false;
			seen.add(round.checkedAt);
			return true;
		}).sort((left, right) => left.checkedAt.localeCompare(right.checkedAt));
		this.rounds.length = 0;
		this.rounds.push(...limit > 0 ? merged.slice(-limit) : []);
		if (this.lastProbeAt === void 0 && this.rounds.length > 0) this.lastProbeAt = this.rounds[this.rounds.length - 1].checkedAt;
	}
	/**
	* The currently active enabled-model filter, as last set.
	* @returns the live selection value.
	*/
	filter() {
		return this.enabledFilter;
	}
	/**
	* Every registered provider/model with its current enabled state, in the
	* order the last round observed them.
	* @returns one entry per registered pair.
	*/
	catalog() {
		return this.catalogTargets.map((target) => ({
			provider: target.provider,
			model: target.model,
			name: target.name,
			enabled: isModelEnabled(this.enabledFilter, target.provider, target.model)
		}));
	}
	/**
	* Keys of every model the most recent enumeration observed, enabled or not.
	* The topology watch compares this against a fresh enumeration: comparing
	* the full catalog (not just probed results) keeps disabled models from
	* looking like perpetual additions.
	* @returns a detached key set.
	*/
	catalogKeys() {
		return new Set(this.catalogTargets.map((target) => modelKey(target.provider, target.model)));
	}
	/**
	* Record the latest outcome for one model, keyed by provider/model.
	* @param result - the probe outcome that becomes the model's current result.
	*/
	record(result) {
		this.results.set(modelKey(result.provider, result.model), result);
	}
	/**
	* Drop every held result whose key is absent from `keys`, after a probe
	* round discovered the current provider/model set. Entries for models that
	* disappeared leave with their provider.
	* @param keys - the complete key set this round observed.
	*/
	reconcile(keys) {
		for (const key of this.results.keys()) if (!keys.has(key)) this.results.delete(key);
	}
	/**
	* Stamp the wall-clock time one full probe round completed and retain the
	* round for history, dropping the oldest entries past the configured limit.
	* @param at - ISO timestamp at which the round's last probe settled.
	*/
	markRound(at) {
		this.lastProbeAt = at;
		if (this.historyLimit <= 0) return;
		const { models } = this.snapshot();
		this.rounds.push({
			checkedAt: at,
			models
		});
		if (this.rounds.length > this.historyLimit) this.rounds.splice(0, this.rounds.length - this.historyLimit);
	}
	/**
	* Retained completed rounds, oldest first.
	* @returns the live history array; treated as read-only by all consumers.
	*/
	history() {
		return this.rounds;
	}
	/**
	* Whether no probe has produced a result yet.
	* @returns true while the store holds no model results.
	*/
	isEmpty() {
		return this.results.size === 0;
	}
	/**
	* Derive a fresh snapshot ordered by provider, then model id, limited to
	* currently-enabled models.
	* @returns one detached snapshot value safe to serialize and hold.
	*/
	snapshot() {
		const filter = this.enabledFilter;
		const models = [...this.results.values()].filter((model) => isModelEnabled(filter, model.provider, model.model)).sort((left, right) => left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model));
		return {
			...this.lastProbeAt === void 0 ? {} : { checkedAt: this.lastProbeAt },
			models
		};
	}
};
/** Delay between a deferred credential-pending round and its prompt re-probe. */
const DEFAULT_CREDENTIAL_RETRY_DELAY_MS = 3e3;
/** Deferrals a model may accumulate before its credential-pending failure is recorded for real. */
const DEFAULT_CREDENTIAL_RETRY_LIMIT = 3;
/**
* Probe failure codes that read as "credentials not ready yet" rather than a
* definitive failure. At startup the credential seam loads asynchronously, so a
* probe that runs first can fail MISSING_CREDENTIAL and self-heal a moment
* later; the monitor re-probes those instead of stamping a spurious error.
*/
const CREDENTIAL_PENDING_CODES = new Set(["MISSING_CREDENTIAL"]);
/** One process-local owner of the periodic probe loop. */
var ModelHealthMonitor = class {
	options;
	timer;
	watchTimer;
	credentialTimer;
	currentRun;
	/** A trigger landed while a round was in flight; one follow-up is owed. */
	pendingRound = false;
	disposed = false;
	/** Keys that have answered healthily at least once this process; missing-key failures below are transient-at-boot. */
	succeeded = /* @__PURE__ */ new Set();
	/** Credential-pending deferrals already spent per key, bounding the retry loop. */
	pendingCount = /* @__PURE__ */ new Map();
	/**
	* @param options - construction facts; the caller keeps ownership of `ctx` and `store`.
	*/
	constructor(options) {
		this.options = options;
		this.options.store.setFilter(this.options.filter ?? {});
	}
	/**
	* Replace the enabled-model selection and start an immediate round so the UI
	* reflects the new coverage without waiting for the next timer tick.
	* @param filter - the new selection.
	*/
	setFilter(filter) {
		this.options.store.setFilter(filter);
		this.notify();
		this.trigger();
	}
	/** Fire the optional post-snapshot callback (history + filter persisted). */
	notify() {
		this.options.onSnapshot?.(this.options.store);
	}
	/**
	* Begin the periodic loop. The first round runs immediately — waiting one
	* full interval left a fresh install (or restart) showing nothing for up to
	* `intervalMs`. A repeat start arms nothing new.
	*/
	start() {
		if (this.disposed || this.timer !== void 0) return;
		this.trigger();
		this.arm();
		this.armWatch();
	}
	/**
	* Run one complete round now, coalescing with an in-flight round so a
	* manual refresh and a timer tick never overlap. A request that lands while
	* a round runs is not dropped: it schedules exactly one follow-up round,
	* because the in-flight round enumerated before the change that caused it —
	* a provider registered mid-round would otherwise stay invisible for a full
	* interval. A fiber already torn down starts nothing: a tool execution that
	* outlives disposal must not spend real provider traffic on a dead owner.
	* @returns the round that produced (or is producing) the fresh snapshot.
	*/
	runNow() {
		if (this.disposed) return Promise.resolve();
		if (this.currentRun !== void 0) {
			this.pendingRound = true;
			return this.currentRun;
		}
		const run = this.runRound().finally(() => {
			this.currentRun = void 0;
			if (this.pendingRound && !this.disposed) {
				this.pendingRound = false;
				this.runNow();
			}
		});
		this.currentRun = run;
		return run;
	}
	/** Request an asynchronous round without awaiting it, for topology changes. */
	trigger() {
		if (this.disposed) return;
		this.runNow();
	}
	/** Stop future rounds and clear both armed timers. In-flight rounds finish on their own. */
	dispose() {
		this.disposed = true;
		if (this.timer !== void 0) clearTimeout(this.timer);
		this.timer = void 0;
		if (this.watchTimer !== void 0) clearTimeout(this.watchTimer);
		this.watchTimer = void 0;
		if (this.credentialTimer !== void 0) clearTimeout(this.credentialTimer);
		this.credentialTimer = void 0;
	}
	/**
	* Arm one bounded segment; the callback re-arms for the next interval.
	* Callers own the disposed/duplicate guards, and disposal clears the only armed timer.
	*/
	arm() {
		this.timer = setTimeout(() => {
			this.timer = void 0;
			this.trigger();
			this.arm();
		}, Math.min(this.options.intervalMs, MAX_TIMER_DELAY_MS));
	}
	/** Arm the enumeration-only catalog sweep; each sweep re-arms itself. */
	armWatch() {
		const watchMs = this.options.watchMs ?? 15e3;
		if (watchMs <= 0) return;
		this.watchTimer = setTimeout(() => {
			this.watchTimer = void 0;
			this.watchCatalog().finally(() => {
				if (!this.disposed) this.armWatch();
			});
		}, Math.min(watchMs, MAX_TIMER_DELAY_MS));
	}
	/** Whether a result failed with a credential-not-ready code. */
	isCredentialPending(result) {
		return result.error?.code !== void 0 && CREDENTIAL_PENDING_CODES.has(result.error.code);
	}
	/** Spend one deferral for a key; false once the configured limit is exhausted or disabled. */
	deferCredential(key) {
		const limit = this.options.credentialRetryLimit ?? 3;
		if (limit <= 0) return false;
		const used = this.pendingCount.get(key) ?? 0;
		if (used >= limit) return false;
		this.pendingCount.set(key, used + 1);
		return true;
	}
	/** Arm a single prompt re-probe; a deferred round’s next failure re-arms it. */
	armCredentialRetry() {
		if (this.disposed || this.credentialTimer !== void 0) return;
		this.credentialTimer = setTimeout(() => {
			this.credentialTimer = void 0;
			this.trigger();
		}, Math.min(this.options.credentialRetryDelayMs ?? 3e3, MAX_TIMER_DELAY_MS));
	}
	/**
	* Enumerate the catalog without probing and compare it with what the store
	* already knows. Enumeration is a local read on every shipping adapter, so
	* the sweep is cheap enough to run far more often than a probe round. A
	* changed key set updates the stored catalog (the settings checkbox list
	* shows the new model right away) and starts a prompt full round; a sweep
	* landing mid-round funnels through the same follow-up queue as any trigger.
	*/
	async watchCatalog() {
		if (this.disposed) return;
		if (this.currentRun !== void 0) {
			this.trigger();
			return;
		}
		try {
			const all = await listProbeTargets(this.options.ctx, this.options.providers, this.options.models);
			const known = this.options.store.catalogKeys();
			this.options.store.setCatalog(all);
			if (!sameKeys(new Set(all.map((target) => modelKey(target.provider, target.model))), known)) this.trigger();
		} catch {}
	}
	/** Enumerate, probe, and reconcile one round; a contained failure leaves prior results in place. */
	async runRound() {
		try {
			const all = await listProbeTargets(this.options.ctx, this.options.providers, this.options.models);
			this.options.store.setCatalog(all);
			const results = await runWithConcurrency(filterTargets(all, this.options.store.filter()), this.options.concurrency, (target) => probeModel(this.options.ctx, target, this.options));
			const recordedKeys = /* @__PURE__ */ new Set();
			let deferredCredential = false;
			for (const result of results) {
				const key = modelKey(result.provider, result.model);
				if (result.ok) {
					this.succeeded.add(key);
					this.options.store.record(result);
					recordedKeys.add(key);
				} else if (this.isCredentialPending(result) && !this.succeeded.has(key) && this.deferCredential(key)) deferredCredential = true;
				else {
					this.options.store.record(result);
					recordedKeys.add(key);
				}
			}
			this.options.store.reconcile(recordedKeys);
			this.options.store.markRound((/* @__PURE__ */ new Date()).toISOString());
			this.notify();
			if (deferredCredential) this.armCredentialRetry();
		} catch (error) {
			this.options.ctx.logger.warn(`model-health: probe round failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
};
/** Whether two key sets hold exactly the same members. */
function sameKeys(left, right) {
	if (left.size !== right.size) return false;
	for (const key of left) if (!right.has(key)) return false;
	return true;
}
//#endregion
//#region lib/types/persistence.js
/**
* Optional durable persistence for the model-health plugin. Keeps the probe
* history and the enabled-model filter in one JSON document under the
* harness home (`~/.dsH/model-health.json` by default) so a restart does not
* wipe a user's accumulated trend or their model selection. Failure to read or
* write is a diagnostic, never fatal: the store keeps running in memory.
* @module dsh-model-health
*/
/** Retry/backoff/timing matches {@linkcode withFileLock} so this writer never
*  fights a live `@deepseek-ai/dsh-atomic-write` contender for the same file. */
const LOCK_RETRY_INITIAL_MS = 20;
const LOCK_RETRY_MAX_MS = 200;
const LOCK_TIMEOUT_MS = 2e3;
/** Default file name under the harness home. */
const DEFAULT_PERSIST_FILE = "model-health.json";
/**
* Load the persisted document, tolerating an absent or malformed file.
* @param opts - optional custom filename.
* @returns the parsed document, or an empty one when nothing durable is readable.
*/
async function loadPersistence(opts = {}) {
	const filename = resolveFilename(opts);
	try {
		const raw = await readFile(filename, "utf8");
		const parsed = JSON.parse(raw);
		return {
			rounds: Array.isArray(parsed.rounds) ? parsed.rounds : [],
			...isFilter(parsed.filter) ? { filter: sanitizeFilterInput(parsed.filter) } : {},
			...typeof parsed.writtenAt === "string" ? { writtenAt: parsed.writtenAt } : {}
		};
	} catch (error) {
		if (isMissing(error)) return { rounds: [] };
		throw error;
	}
}
/**
* Write a durable snapshot under a writer lock so concurrent writers do not
* corrupt the document.
* @param snapshot - rounds + optional enabled selection.
* @param opts - optional custom filename.
*/
async function savePersistence(snapshot, opts = {}) {
	const filename = resolveFilename(opts);
	const payload = JSON.stringify({
		...snapshot,
		writtenAt: (/* @__PURE__ */ new Date()).toISOString()
	}, null, 2);
	await withReapingLock(filename, async () => {
		await mkdir(dirname(filename), { recursive: true });
		await writeFile(filename, payload);
	});
}
/**
* Serialize one write the same way `@deepseek-ai/dsh-atomic-write`'s
* {@linkcode withFileLock} does — `<file>.lock` created exclusively, held for
* the operation, removed on both outcomes — but with one difference: a lock
* whose recorded holder PID is no longer a live process is an orphan (the
* writer crashed, or the host was hard-killed) and is reclaimed instead of
* derailing every later write for the full {@linkcode LOCK_TIMEOUT_MS}. This is
* the durability counterpart to {@linkcode loadPersistence} tolerating a crash:
* a stale sibling would otherwise silently freeze persistence — the in-memory
* store keeps showing live toggles while the document is never updated, so on
* restart the user's settings appear to revert.
*
* Reclaiming never touches a lock held by a live PID, so it cannot damage a
* currently-writing peer. A lock file whose PID is unreadable (empty or
* malformed) is safest to leave alone: `@deepseek-ai/dsh-atomic-write` writes a
* bare PID, so an unparsable one belongs to a different writer convention.
* @param filename - the document being written.
* @param operation - the read-render-commit cycle to run under the lock.
*/
async function withReapingLock(filename, operation) {
	const lockPath = `${filename}.lock`;
	await acquireLock(lockPath);
	try {
		await operation();
	} finally {
		await rm(lockPath, { force: true });
	}
}
/** Create the lock file, reclaiming a dead holder's lock when contention shows it. */
async function acquireLock(lockPath) {
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	let delay = LOCK_RETRY_INITIAL_MS;
	for (;;) {
		try {
			await writeFile(lockPath, `${process.pid}\n`, {
				mode: 384,
				flag: "wx"
			});
			return;
		} catch (error) {
			if (!isEEXIST(error)) throw error;
		}
		if (await reclaimIfStale(lockPath)) continue;
		if (Date.now() >= deadline) throw new Error(`model-health: timed out waiting for the writer lock at ${lockPath}`);
		await new Promise((resolve) => setTimeout(resolve, delay));
		delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS);
	}
}
/** Remove the sibling lock if its recorded PID is provably gone; returns whether it was reclaimed. */
async function reclaimIfStale(lockPath) {
	let raw;
	try {
		raw = await readFile(lockPath, "utf8");
	} catch {
		return false;
	}
	const pid = Number(raw.trim());
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	if (isPidAlive(pid)) return false;
	await rm(lockPath, { force: true }).catch(() => void 0);
	return true;
}
/** Whether a PID maps to a live process. `EPERM` means it exists but is owned by another user (alive). */
function isPidAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}
/** Whether an error is an exclusive-create collision. */
function isEEXIST(error) {
	return typeof error === "object" && error !== null && error.code === "EEXIST";
}
/** Resolve the persistence path, honouring an override. */
function resolveFilename(opts) {
	return opts.filename ?? dshHomePath("model-health.json");
}
/** Whether an unknown value looks like a filter object (no throw). */
function isFilter(value) {
	return typeof value === "object" && value !== null;
}
/** Whether an fs error means the file does not exist (a normal first run). */
function isMissing(error) {
	return typeof error === "object" && error !== null && error.code === "ENOENT";
}
//#endregion
//#region lib/types/tools.js
/**
* Model-facing `model_status` tool over the in-memory probe store.
* @module dsh-model-health
*/
const SNAPSHOT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		checkedAt: { type: "string" },
		models: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					provider: {
						type: "string",
						required: true
					},
					model: {
						type: "string",
						required: true
					},
					name: {
						type: "string",
						required: true
					},
					checkedAt: {
						type: "string",
						required: true
					},
					ok: {
						type: "boolean",
						required: true
					},
					ttftMs: { type: "number" },
					totalMs: { type: "number" },
					error: {
						type: "object",
						additionalProperties: false,
						properties: {
							code: {
								type: "string",
								required: true
							},
							message: {
								type: "string",
								required: true
							},
							status: { type: "integer" }
						}
					}
				}
			}
		}
	}
};
const DESCRIPTION = "Report the latest connectivity and latency check for every model currently registered with a provider. Each result carries ok, time-to-first-token and total round-trip latency in milliseconds, the check timestamp, and the error code/status when the check failed. Set refresh true to run a fresh check of every model now instead of returning the latest results.";
/**
* Register the global `model_status` tool. Disposing the returned disposer
* (or the plugin fiber) unregisters it.
* @param ctx - context owning the tool runtime.
* @param deps - store and round runner the tool reads.
* @returns the registration disposer.
*/
function registerModelHealthTool(ctx, deps) {
	return ctx.tools.register(defineTool({
		name: "model_status",
		description: DESCRIPTION,
		parameters: { refresh: {
			type: "boolean",
			description: "When true, probe every registered model now and return those results; may take several seconds per model."
		} },
		output: jsonOutput(SNAPSHOT_SCHEMA),
		async execute(args, _exec) {
			if (args.refresh === true || deps.store.isEmpty()) await deps.runNow();
			return deps.store.snapshot();
		},
		presentCall: (args) => ({
			card: "generic",
			title: args.refresh === true ? "Check model status" : "Model status",
			kind: "read"
		})
	}));
}
/** Declare one canonical output schema with compact model-facing JSON. */
function jsonOutput(schema) {
	return {
		schema,
		render: (_args, value) => [{
			type: "text",
			text: JSON.stringify(value)
		}]
	};
}
//#endregion
//#region lib/types/index.js
/**
* Periodic model-health probes over `ctx.llm`. Enumerates every registered
* provider/model route, runs one bounded minimal round-trip per model on a
* timer, and surfaces the latest results through the global `model_status`
* tool plus a local HTTP status JSON (snapshot and retained rounds) when a
* host web server is mounted. Disposable projections only: the llm runtime
* owns provider/model registration, and this plugin owns nothing durable.
* @module dsh-model-health
*/
/** Default seconds between automatic probe rounds. */
const DEFAULT_INTERVAL_SECONDS = 300;
/** Default per-probe deadline; a round over it records PROBE_TIMEOUT. Slow
*  reasoners that already streamed count as healthy at the cutoff. */
const DEFAULT_PROBE_TIMEOUT_MS = 3e4;
/** Default cap on simultaneously in-flight probes. */
const DEFAULT_CONCURRENCY = 2;
/** Default minimal request text every probe sends. */
const DEFAULT_PROBE_PROMPT = "ping";
/** Default token ceiling every probe requests, keeping the probe at its floor. */
const DEFAULT_PROBE_MAX_TOKENS = 1;
/** Default rounds retained in memory for trend rendering; 0 drops history. */
const DEFAULT_HISTORY_LIMIT = 40;
/** Default absolute pathname of the status JSON route. */
const DEFAULT_HTTP_PATH = "/api/model-health";
/** Largest interval the timer arm can represent; larger values clamp in `arm`. */
const MAX_INTERVAL_SECONDS = Math.floor(MAX_TIMER_DELAY_MS / 1e3);
const MAX_CONCURRENCY = 32;
/** Retained rounds comfortable for local JSON payloads (40 rounds × models stays small). */
const MAX_HISTORY_LIMIT = 200;
/** Cordis function-plugin name. */
const name = "model-health";
/** Services required before probes or the tool can run. */
const inject = ["llm", "tools"];
const Config = Schema.object({
	enabled: Schema.boolean().default(true),
	intervalSeconds: Schema.number().step(1).min(1).max(MAX_INTERVAL_SECONDS).default(300),
	probeTimeoutMs: Schema.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_PROBE_TIMEOUT_MS),
	concurrency: Schema.number().step(1).min(1).max(MAX_CONCURRENCY).default(2),
	probePrompt: Schema.string().default(DEFAULT_PROBE_PROMPT),
	probeMaxTokens: Schema.number().step(1).min(1).default(1),
	historyLimit: Schema.number().step(1).min(0).max(MAX_HISTORY_LIMIT).default(40),
	httpEnabled: Schema.boolean().default(true),
	httpPath: Schema.string().default(DEFAULT_HTTP_PATH),
	persistFile: Schema.string(),
	providers: Schema.array(Schema.string()).default(void 0),
	models: Schema.array(Schema.string()).default(void 0),
	credentialRetryDelayMs: Schema.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_CREDENTIAL_RETRY_DELAY_MS),
	credentialRetryLimit: Schema.number().step(1).min(0).default(3)
});
/**
* Resolve raw config into validated construction facts. Programmatic
* construction may bypass Schemastery, so every bound is re-judged here and a
* misconfiguration fails loud at load.
* @param config - raw plugin config.
* @returns detached, validated facts.
*/
function resolveConfig(config) {
	const intervalSeconds = config.intervalSeconds ?? 300;
	if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > MAX_INTERVAL_SECONDS) throw new Error(`model-health: intervalSeconds must be an integer from 1 through ${MAX_INTERVAL_SECONDS}`);
	const probeTimeoutMs = config.probeTimeoutMs ?? 3e4;
	if (!Number.isFinite(probeTimeoutMs) || probeTimeoutMs <= 0 || probeTimeoutMs > MAX_TIMER_DELAY_MS) throw new Error(`model-health: probeTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
	const concurrency = config.concurrency ?? 2;
	if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) throw new Error(`model-health: concurrency must be an integer from 1 through ${MAX_CONCURRENCY}`);
	const probePrompt = (config.probePrompt ?? "ping").trim();
	if (probePrompt.length === 0) throw new Error("model-health: probePrompt must be non-empty after trimming");
	const probeMaxTokens = config.probeMaxTokens ?? 1;
	if (!Number.isSafeInteger(probeMaxTokens) || probeMaxTokens < 1) throw new Error("model-health: probeMaxTokens must be a positive safe integer");
	const historyLimit = config.historyLimit ?? 40;
	if (!Number.isSafeInteger(historyLimit) || historyLimit < 0 || historyLimit > MAX_HISTORY_LIMIT) throw new Error(`model-health: historyLimit must be an integer from 0 through ${MAX_HISTORY_LIMIT}`);
	const httpPath = config.httpPath ?? "/api/model-health";
	if (!httpPath.startsWith("/") || httpPath.length < 2 || httpPath.endsWith("/") || httpPath.includes("//") || /[\s?#]/.test(httpPath)) throw new Error("model-health: httpPath must be an absolute pathname without a trailing slash, empty segments, query, fragment, or whitespace");
	const providers = normalizeFilter(config.providers, "providers");
	const models = normalizeFilter(config.models, "models");
	for (const entry of models ?? []) if (!entry.includes("/")) throw new Error("model-health: each models entry must be `provider/model`");
	const credentialRetryDelayMs = config.credentialRetryDelayMs ?? 3e3;
	if (!Number.isSafeInteger(credentialRetryDelayMs) || credentialRetryDelayMs < 1 || credentialRetryDelayMs > MAX_TIMER_DELAY_MS) throw new Error(`model-health: credentialRetryDelayMs must be an integer from 1 through ${MAX_TIMER_DELAY_MS}`);
	const credentialRetryLimit = config.credentialRetryLimit ?? 3;
	if (!Number.isSafeInteger(credentialRetryLimit) || credentialRetryLimit < 0) throw new Error("model-health: credentialRetryLimit must be a non-negative integer");
	return {
		enabled: config.enabled ?? true,
		intervalSeconds,
		intervalMs: intervalSeconds * 1e3,
		probeTimeoutMs,
		concurrency,
		probePrompt,
		probeMaxTokens,
		historyLimit,
		httpEnabled: config.httpEnabled ?? true,
		httpPath,
		persistFile: config.persistFile !== void 0 && config.persistFile.length > 0 ? config.persistFile : dshHomePath(DEFAULT_PERSIST_FILE),
		providers,
		models,
		credentialRetryDelayMs,
		credentialRetryLimit
	};
}
/** Deduplicate and validate a string filter list; empty array becomes undefined (no filter). */
function normalizeFilter(list, field) {
	if (list === void 0) return void 0;
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const entry of list) {
		if (typeof entry !== "string" || entry.length === 0) throw new Error(`model-health: ${field} entries must be non-empty strings`);
		if (!seen.has(entry)) {
			seen.add(entry);
			out.push(entry);
		}
	}
	return out.length > 0 ? out : void 0;
}
/** Install the store, timer owner, and tool; re-scan when the provider topology changes. */
function apply(ctx, config = {}) {
	const resolved = resolveConfig(config);
	if (!resolved.enabled) return;
	const store = new ModelHealthStore(resolved.historyLimit);
	const persistenceOpts = { filename: resolved.persistFile };
	let ready = false;
	const persist = () => {
		if (!ready) return;
		savePersistence({
			rounds: store.history(),
			filter: store.filter()
		}, persistenceOpts).catch((error) => {
			ctx.logger.warn(`model-health: persist failed: ${error instanceof Error ? error.message : String(error)}`);
		});
	};
	const monitor = new ModelHealthMonitor({
		ctx,
		store,
		intervalMs: resolved.intervalMs,
		probeTimeoutMs: resolved.probeTimeoutMs,
		concurrency: resolved.concurrency,
		probePrompt: resolved.probePrompt,
		probeMaxTokens: resolved.probeMaxTokens,
		providers: resolved.providers,
		models: resolved.models,
		credentialRetryDelayMs: resolved.credentialRetryDelayMs,
		credentialRetryLimit: resolved.credentialRetryLimit,
		onSnapshot: () => {
			persist();
		}
	});
	const disposeTool = registerModelHealthTool(ctx, {
		store,
		runNow: () => monitor.runNow()
	});
	const stopUpdated = ctx.on("llm/adapters-updated", () => {
		monitor.trigger();
	});
	const disposeRoute = resolved.httpEnabled ? registerModelHealthRoute(ctx, {
		store,
		monitor,
		path: resolved.httpPath,
		statusConfig: {
			intervalSeconds: resolved.intervalSeconds,
			historyLimit: resolved.historyLimit
		}
	}) : void 0;
	let disposed = false;
	loadPersistence(persistenceOpts).then((persisted) => {
		if (disposed) return;
		store.seedHistory(persisted.rounds);
		const filter = persisted.filter;
		const hasSelection = (filter?.disabledProviders?.length ?? 0) > 0 || (filter?.disabledModels?.length ?? 0) > 0;
		if (filter !== void 0 && hasSelection) monitor.setFilter(filter);
	}).catch((error) => {
		ctx.logger.warn(`model-health: could not load persistence: ${error instanceof Error ? error.message : String(error)}`);
	}).finally(() => {
		if (disposed) return;
		ready = true;
		monitor.start();
	});
	ctx.effect(() => () => {
		disposed = true;
		disposeRoute?.();
		stopUpdated();
		disposeTool();
		monitor.dispose();
	}, "model-health.lifecycle()");
}
//#endregion
export { Config, DEFAULT_CONCURRENCY, DEFAULT_CREDENTIAL_RETRY_DELAY_MS, DEFAULT_CREDENTIAL_RETRY_LIMIT, DEFAULT_HISTORY_LIMIT, DEFAULT_HTTP_PATH, DEFAULT_INTERVAL_SECONDS, DEFAULT_PROBE_MAX_TOKENS, DEFAULT_PROBE_PROMPT, DEFAULT_PROBE_TIMEOUT_MS, apply, inject, name, resolveConfig };

//# sourceMappingURL=index.js.map