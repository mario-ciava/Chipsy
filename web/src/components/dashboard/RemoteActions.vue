<template>
    <div class="card">
        <div class="card__header">
            <h3 class="card__title">Azioni rapide</h3>
            <p class="card__subtitle">
                Struttura modulare pronta per aggiungere comandi remoti in futuro.
            </p>
        </div>
        <div class="card__body">
            <ul class="actions">
                <li v-for="action in actions" :key="action.id" class="actions__item">
                    <div>
                        <h4 class="actions__title">{{ action.label }}</h4>
                        <p class="actions__description">{{ action.description }}</p>
                    </div>
                    <button class="button button--ghost" disabled>
                        In arrivo
                    </button>
                </li>
            </ul>
            <p v-if="!actions.length" class="actions__empty">
                Non sono ancora state configurate azioni remote. Aggiungile lato server per attivarle qui.
            </p>
        </div>
    </div>
</template>

<script>
export default {
    name: "RemoteActions",
    props: {
        actions: {
            type: Array,
            default: () => []
        }
    }
}
</script>
