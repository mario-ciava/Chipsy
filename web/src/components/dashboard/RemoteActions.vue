<template>
    <div class="card">
        <div class="card__header">
            <h3 class="card__title">Azioni rapide</h3>
        </div>
        <div class="card__body">
            <p class="card__subtitle">
                Struttura modulare pronta per aggiungere comandi remoti in futuro.
            </p>
            <ul class="actions">
                <li v-for="action in actions" :key="action.id" class="actions__item">
                    <div>
                        <h4 class="actions__title">{{ action.label }}</h4>
                        <p class="actions__description">{{ action.description }}</p>
                    </div>
                    <button
                        v-if="action.type === 'command'"
                        class="button button--secondary"
                        :class="{ 'button--danger': action.dangerous }"
                        :disabled="loading"
                        @click="handleAction(action)"
                    >
                        <span v-if="loading" class="button__spinner"></span>
                        <span v-else>Esegui</span>
                    </button>
                    <button v-else class="button button--ghost" disabled>
                        In arrivo
                    </button>
                </li>
            </ul>
            <p v-if="!actions.length" class="actions__empty">
                Non sono ancora state configurate azioni remote. Aggiungile lato server per attivarle qui.
            </p>
        </div>

        <transition name="fade">
            <div v-if="showConfirm" class="modal-overlay" @click.self="cancelConfirm">
                <div class="modal-dialog">
                    <div class="modal-header">
                        <h3 class="modal-title">{{ confirmTitle }}</h3>
                    </div>
                    <div class="modal-body">
                        <p>{{ confirmMessage }}</p>
                    </div>
                    <div class="modal-footer">
                        <button class="button button--ghost" @click="cancelConfirm">
                            Annulla
                        </button>
                        <button class="button button--danger" @click="proceedConfirm">
                            {{ confirmStep === 1 ? 'Continua' : 'Conferma' }}
                        </button>
                    </div>
                </div>
            </div>
        </transition>
    </div>
</template>

<script>
import api from "../../services/api"

export default {
    name: "RemoteActions",
    props: {
        actions: {
            type: Array,
            default: () => []
        }
    },
    data() {
        return {
            loading: false,
            showConfirm: false,
            confirmStep: 0,
            pendingAction: null
        }
    },
    computed: {
        confirmTitle() {
            if (this.confirmStep === 1) {
                return "Conferma azione"
            }
            return "Conferma definitiva"
        },
        confirmMessage() {
            if (this.confirmStep === 1) {
                return "Sei sicuro di voler terminare il processo del bot? Questa azione richiederà un riavvio manuale del bot."
            }
            return "ATTENZIONE: Questa azione terminerà immediatamente il processo. Sei assolutamente sicuro di voler continuare?"
        }
    },
    methods: {
        handleAction(action) {
            if (action.dangerous) {
                this.pendingAction = action
                this.confirmStep = 1
                this.showConfirm = true
            } else {
                this.executeAction(action)
            }
        },
        proceedConfirm() {
            if (this.confirmStep === 1) {
                this.confirmStep = 2
            } else {
                this.showConfirm = false
                if (this.pendingAction) {
                    this.executeAction(this.pendingAction)
                }
            }
        },
        cancelConfirm() {
            this.showConfirm = false
            this.confirmStep = 0
            this.pendingAction = null
        },
        async executeAction(action) {
            if (action.id === "bot-kill") {
                await this.killBot()
            }
        },
        async killBot() {
            this.loading = true
            try {
                const csrfToken = this.$store.state.session.csrfToken
                if (!csrfToken) {
                    throw new Error("Missing authentication context")
                }
                await api.killBot({ csrfToken })
                this.$emit("action-success", "Il processo del bot verrà terminato a breve.")
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Failed to kill bot process", error)
                this.$emit("action-error", "Impossibile terminare il processo del bot.")
            } finally {
                this.loading = false
            }
        }
    }
}
</script>

<style scoped>
.button__spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

.button--danger {
    background: rgba(248, 113, 113, 0.2);
    color: #fecaca;
    border: 1px solid rgba(248, 113, 113, 0.35);
}

.button--danger:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.3);
}

.modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.85);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.modal-dialog {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-xl);
    padding: 28px;
    max-width: 500px;
    width: 90%;
    box-shadow: 0 40px 80px -24px rgba(15, 23, 42, 0.85);
}

.modal-header {
    margin-bottom: 16px;
}

.modal-title {
    margin: 0;
    font-size: 1.4rem;
    color: var(--fg-primary);
}

.modal-body {
    margin-bottom: 24px;
    color: var(--fg-muted);
}

.modal-body p {
    margin: 0;
}

.modal-footer {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>
