<template>
    <button
        type="button"
        :class="[rootClass, variantClass, stateClasses]"
        :disabled="isLocked"
        role="switch"
        :aria-checked="checked ? 'true' : 'false'"
        :aria-label="resolvedAriaLabel"
        :aria-busy="busy ? 'true' : 'false'"
        @click="handleClick"
    >
        <span class="chip-toggle__track">
            <span class="chip-toggle__status" :class="toneClass">
                <slot>{{ label }}</slot>
            </span>
            <span class="chip-toggle__thumb"></span>
        </span>
    </button>
</template>

<script>
export default {
    name: "ChipToggle",
    props: {
        label: {
            type: String,
            required: true
        },
        checked: {
            type: Boolean,
            default: false
        },
        disabled: {
            type: Boolean,
            default: false
        },
        busy: {
            type: Boolean,
            default: false
        },
        tone: {
            type: String,
            default: ""
        },
        variant: {
            type: String,
            default: "bare"
        },
        visualOn: {
            type: Boolean,
            default: null
        },
        ariaLabel: {
            type: String,
            default: ""
        }
    },
    emits: ["toggle"],
    computed: {
        isLocked() {
            return this.disabled || this.busy
        },
        rootClass() {
            return this.variant === "bare" ? "chip-toggle-bare" : "chip-toggle"
        },
        variantClass() {
            return this.variant ? `chip-toggle--${this.variant}` : ""
        },
        isOn() {
            return this.visualOn === null ? this.checked : this.visualOn
        },
        stateClasses() {
            return {
                "chip-toggle--on": this.isOn,
                "chip-toggle--disabled": this.isLocked
            }
        },
        toneClass() {
            if (!this.tone) return ""
            const toneMap = {
                ok: "chip-toggle__status--ok",
                warn: "chip-toggle__status--warn",
                danger: "chip-toggle__status--danger"
            }
            return toneMap[this.tone] || ""
        },
        resolvedAriaLabel() {
            return this.ariaLabel || this.label
        }
    },
    methods: {
        handleClick() {
            if (this.isLocked) return
            this.$emit("toggle", !this.checked)
        }
    }
}
</script>
