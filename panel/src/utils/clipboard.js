const fallbackCopy = (text) => {
    return new Promise((resolve, reject) => {
        if (typeof document === "undefined") {
            reject(new Error("Clipboard API is unavailable."))
            return
        }

        const textarea = document.createElement("textarea")
        textarea.value = text
        textarea.setAttribute("readonly", "")
        textarea.style.position = "absolute"
        textarea.style.left = "-9999px"

        document.body.appendChild(textarea)
        textarea.select()

        try {
            const successful = document.execCommand("copy")
            document.body.removeChild(textarea)
            if (!successful) {
                throw new Error("Copy command was rejected.")
            }
            resolve(true)
        } catch (error) {
            document.body.removeChild(textarea)
            reject(error)
        }
    })
}

export const copyToClipboard = async(value) => {
    const text = value == null ? "" : String(value)
    if (!text) {
        throw new Error("Nothing to copy.")
    }

    const hasNavigatorClipboard = typeof navigator !== "undefined"
        && navigator.clipboard
        && typeof navigator.clipboard.writeText === "function"

    if (hasNavigatorClipboard) {
        await navigator.clipboard.writeText(text)
        return true
    }

    return fallbackCopy(text)
}

