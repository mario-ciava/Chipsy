export const showToast = (message) => {
    if (!message || typeof window === "undefined") return
    window.dispatchEvent(new CustomEvent("chipsy-toast", { detail: { message } }))
}
