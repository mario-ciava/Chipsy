const DEFAULT_LOCALE = "en-US"
const DEFAULT_CURRENCY_SYMBOL = "$"

const DEFAULT_DATE_TIME_OPTIONS = {
    dateStyle: "short",
    timeStyle: "short"
}

const DETAILED_DATE_TIME_OPTIONS = {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
}

export const formatCurrency = (value, { locale = DEFAULT_LOCALE, currencySymbol = DEFAULT_CURRENCY_SYMBOL } = {}) => {
    const amount = Number(value) || 0
    return `${amount.toLocaleString(locale)} ${currencySymbol}`
}

export const formatPercentage = (value, fractionDigits = 2) => {
    const numeric = Number(value) || 0
    return `${numeric.toFixed(fractionDigits)} %`
}

export const formatExpRange = (current, required, locale = DEFAULT_LOCALE) => {
    const currentValue = Number(current || 0)
    const requiredValue = Number(required || 0)
    return `${currentValue.toLocaleString(locale)} / ${requiredValue.toLocaleString(locale)}`
}

export const formatDateTime = (value, options = DEFAULT_DATE_TIME_OPTIONS, locale = DEFAULT_LOCALE) => {
    if (!value) return "N/A"
    try {
        const date = new Date(value)
        const formatter = new Intl.DateTimeFormat(locale, options)
        return formatter.format(date)
    } catch (_error) {
        return "N/A"
    }
}

export const formatDetailedDateTime = (value, locale = DEFAULT_LOCALE) => {
    return formatDateTime(value, DETAILED_DATE_TIME_OPTIONS, locale)
}
