exports.classes = {
    "Bronze III": 50000,
    "Bronze II": 100000,
    "Bronze I": 150000,
    "Silver III": 250000,
    "Silver II": 500000,
    "Silver I": 750000,
    "Gold III": 1500000,
    "Gold II": 5000000,
    "Gold I": 20000000,
    "Platinum III": 75000000,
    "Platinum II": 150000000,
    "Platinum I": 300000000,
    "Diamond III": 500000000,
    "Diamond II": 750000000,
    "Diamond I": 1000000000
}

exports.getUserClass = (money) => {
    var result = Object.values(exports.classes).find((cl) => {
        return money - cl < 0
    })
    if (money >= Object.values(exports.classes)[Object.values(exports.classes).length - 1]) {
        result = Object.keys(exports.classes)[Object.keys(exports.classes).length - 1]
        return result
    } else if (result && money >= Object.values(exports.classes)[0]) result = Object.keys(exports.classes)[Object.values(exports.classes).indexOf(result) - 1]
        else result = "NONE"
    return result   
}
