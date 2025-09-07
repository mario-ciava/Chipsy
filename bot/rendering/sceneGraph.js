const SceneNodeType = Object.freeze({
    BACKGROUND: "background",
    TITLE: "title",
    BANNER: "banner",
    DIVIDER: "divider",
    HAND: "hand",
    ANNOTATION: "annotation"
});

/**
 * Create a new scene description
 * @param {Object} options
 * @param {number} options.width
 * @param {number} options.height
 * @param {Object} [options.metadata]
 * @param {Object} [options.background]
 * @returns {{ width: number, height: number, metadata: Object, background: Object|null, nodes: Array }}
 */
function createScene({ width, height, metadata = {}, background = null }) {
    return {
        width,
        height,
        metadata,
        background,
        nodes: []
    };
}

/**
 * Append a node to the scene graph
 * @param {Object} scene
 * @param {Object} node
 * @returns {Object} node
 */
function addNode(scene, node) {
    scene.nodes.push(node);
    return node;
}

/**
 * Create a scene node with a specific type
 * @param {string} type
 * @param {Object} props
 * @returns {Object}
 */
function createNode(type, props = {}) {
    return {
        type,
        ...props
    };
}

module.exports = {
    SceneNodeType,
    createScene,
    createNode,
    addNode
};
