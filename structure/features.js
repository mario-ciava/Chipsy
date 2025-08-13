const setSeparator = require("../util/setSeparator")

exports.list = {
    "with-holding": {
        originalValue: 0.0003,
        featureValue: 0.00002,
        startingCost: 250000,
        increase: 1000,
        max: 10,
        apply: (startingValue, level, featureVal) => {
            let result = startingValue
            result -= featureVal * level
            result = parseFloat(result.toFixed(5))
            return result
        }
    },
    "reward-amount": {
        originalValue: 25000,
        featureValue: 1.5,
        startingCost: 250000,
        increase: 1500,
        max: 10,
        apply: (startingValue, level, featureVal) => {
            let result = startingValue
            for (let i=0; i<level; i++)
                result = parseInt(result * featureVal)
            return result
        }
    },
    "reward-time": {
        originalValue: 24,
        featureValue: 0.5,
        startingCost: 150000,
        increase: 1250,
        max: 5,
        apply: (startingValue, level, featureVal) => {
            let result = startingValue
            result -= featureVal * level
            return result
        }
    }
}

exports.getCosts = (feature, withoutSeparator, ex) => {
    if (!exports.list.hasOwnProperty(feature)) return null
    let selected = exports.list[feature],
        costs = [selected.startingCost]
        
    for (let i=0; i<10; i++)
        costs.push(costs[i] + parseInt(Math.sqrt(costs[i]) * selected.increase))

    if (!withoutSeparator) {
        for (let i=0; i<costs.length; i++)
        costs[i] = setSeparator(costs[i])
    }
    return costs
}

exports.get = (feature) => {
    return exports.list[feature]
}

exports.getLevelReward = (level) => {
    var rewards = [5000]
    for (let i=0; i<level; i++)
        rewards.push(rewards[i] + parseInt(Math.sqrt(rewards[i] + (rewards[i] / 100)) * 16))
    return rewards[rewards.length - 1] 
}

exports.applyUpgrades = (feature, level, startingValue, featureVal) => {
    if (!exports.list.hasOwnProperty(feature)) return startingValue
    if (!startingValue) startingValue = exports.list[feature].originalValue
    if (!featureVal) featureVal = exports.list[feature].featureValue
    return exports.list[feature].apply(startingValue, level, featureVal)
}

exports.inputConverter = (input) => {
    if (!input) return undefined
    input = input.split("")
    let output = 0,
        unit = input[input.length - 1],
        number = parseFloat(input.join(""))
    switch(unit) {
        case "k":
            output = number * 1000
        break
        case "m":
            output = number * 1000000
        break
        case "b":
            output = number * 1000000000
        break
    }
    output = parseInt(output)
    return (output != 0 ? output : parseInt(number))
}