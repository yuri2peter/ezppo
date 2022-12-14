// import * as tf from "@tensorflow/tfjs-node";
import * as tf from "@tensorflow/tfjs";
import Network from "./network";
import Buffer from "./buffer";

export type Weights = number[][][];
interface Params {
  // first level of customWeights: actor or critic weights? (size = 2)
  // second level: which layer of network? (size = 10)
  // third level: flattened representation of layer weights
  customWeights?: Weights;
  stateDim: number; // dimensionality of state on each step (feature vector)
  actionDim: number; // amount of discrete actions we can choose from on each step
  numEpochs?: number; // how many epochs to train for per batch?
  numMiniBatches?: number; // how many minibatches to make out of each batch
  learningRate?: number; // learning rate of actor and critic networks
  clipEpsilon?: number;
  gamma?: number;
  lambda?: number;
  entropyCoefficient?: number;
  networkLayerSet?: number[]; // network layer set like [64, 64]
}

export default class Agent {
  actor: Network;
  critic: Network;
  optimizer: tf.AdamOptimizer;
  trainables: tf.Variable[] = [];
  buffer: Buffer;
  numEpochs: number;
  epsilon: number = 0.2;
  gamma: number = 0.99;
  lambda: number = 1.0;
  entropyCoefficient: number = 0.0;

  constructor({
    customWeights = [],
    networkLayerSet = [64, 64],
    stateDim,
    actionDim,
    learningRate = 3e-4,
    clipEpsilon = 0.2,
    gamma = 0.99,
    lambda = 1.0,
    entropyCoefficient = 0.0,
    numMiniBatches = 32,
    numEpochs = 10,
  }: Params) {
    let actorWeights: number[][] = [];
    let criticWeights: number[][] = [];
    if (customWeights.length > 0) {
      actorWeights = customWeights[0];
      criticWeights = customWeights[1];
    }
    // actor needs 6 softmax outputs indicating probability per action
    this.actor = new Network(
      [stateDim, ...networkLayerSet, actionDim],
      actorWeights
    );
    // critic only needs one output indicating the value of the state
    this.critic = new Network([stateDim, ...networkLayerSet, 1], criticWeights);
    this.optimizer = tf.train.adam(learningRate);
    this.trainables = [...this.actor.trainables, ...this.critic.trainables];
    // epsilon refers to PPO clipping parameter
    this.epsilon = clipEpsilon;
    // gamma is the usual discount factor
    this.gamma = gamma;
    // lambda is a necessary GAE parameter
    this.lambda = lambda;
    this.entropyCoefficient = entropyCoefficient;
    this.numEpochs = numEpochs;
    this.buffer = new Buffer(numMiniBatches);
  }

  // sample an action from the softmax probability distribution
  sampleAction(probs: Float32Array | Int32Array | Uint8Array): number {
    // probs is a softmax layer of probabilities, so we have to sample from them.
    // Unfortunately, TensorFlow.js doesn't have automatic Categorical sampling
    // capabilities :(, so we'll have to write our own!
    const rand = Math.random();
    let sum = 0;
    for (let i = 0; i < probs.length; i++) {
      sum += probs[i];
      if (rand < sum) {
        return i;
      }
    }
    // Assuming probs is an actual softmax, we might get this far if, due to
    // round-off error, the sum of probabilities in probs add up to less than 1. In
    // that case, we should choose the last action.
    return probs.length - 1;
  }

  // get the most-likely action from the softmax probability distribution
  mostLikelyAction(probs: Float32Array | Int32Array | Uint8Array): number {
    let maxProb = probs[0];
    let maxIndex = 0;
    for (let i = 1; i < probs.length; i++) {
      if (probs[i] > maxProb) {
        maxIndex = i;
        maxProb = probs[i];
      }
    }
    return maxIndex;
  }

  // preprocesses data to produce advantage estimates
  computeAdvantageEstimates(rewards: number[], values: number[]): number[][] {
    const returns = this.computeReturns(rewards);
    // compute the advantage estimates using GAE
    const advantages = Array(rewards.length).fill(0);
    for (let i = 0; i < rewards.length; i++) {
      let discountFactor = 1;
      let advantageEstimate = 0;
      // do a monte-carlo-like traversal until the end
      for (let j = i; j < rewards.length; j++) {
        const valueNext = j < rewards.length - 1 ? values[j + 1] : 0;
        const delta = rewards[j] + this.gamma * valueNext - values[j];
        advantageEstimate += discountFactor * delta;
        discountFactor *= this.gamma * this.lambda;
      }
      advantages[i] = advantageEstimate;
    }
    return [returns, advantages];
  }

  computeReturns(rewards: number[]): number[] {
    const returns = Array(rewards.length).fill(0);
    let valueNext = 0;
    for (let i = rewards.length - 1; i >= 0; i--) {
      // bootstrap the return based on the next state's value
      returns[i] = rewards[i] + this.gamma * valueNext;
      // backtrack the value of the next state
      valueNext = returns[i];
    }
    return returns;
  }

  computeActorObjective(
    states: tf.Tensor,
    actions: tf.Tensor,
    oldProbs: tf.Tensor,
    advantages: tf.Tensor
  ): tf.Scalar {
    return tf.tidy(() => {
      // compute the new probability of each action that was taken previously
      const probLayers = this.actor.tensorForward(states);
      const probActions = tf.sum(tf.mul(probLayers, actions), 1, false);
      // compute the clipped surrogate objective terms (from PPO paper)
      const ratios = tf.div(probActions, oldProbs);
      const firstTerm = tf.mul(ratios, advantages);
      const secondTerm = tf.mul(
        tf.clipByValue(ratios, 1 - this.epsilon, 1 + this.epsilon),
        advantages
      );
      const clipObjective = tf
        .mean(tf.minimum(firstTerm, secondTerm))
        .asScalar();
      return clipObjective;
    });
  }

  getEntropy(probs: tf.Tensor): tf.Tensor {
    return tf.tidy(() => {
      // avoid numerical error of doing 0*log(0)
      const floorProbs = tf.maximum(probs, 1e-8);
      const individualEntropys = tf.neg(tf.mul(floorProbs, tf.log(floorProbs)));
      const stateEntropys = tf.sum(individualEntropys, 1);
      const averageEntropy = tf.mean(stateEntropys);
      return averageEntropy;
    });
  }

  computeCriticLoss(states: tf.Tensor, returns: tf.Tensor): tf.Scalar {
    return tf.tidy(() => {
      const values = tf.squeeze(this.critic.tensorForward(states));
      const squaredErrors = tf.squaredDifference(returns, values);
      const meanSquareError = squaredErrors.mean().asScalar();
      return meanSquareError;
    });
  }

  computeTotalLoss(
    states: tf.Tensor,
    actions: tf.Tensor,
    oldProbs: tf.Tensor,
    returns: tf.Tensor,
    advantages: tf.Tensor
  ): tf.Scalar {
    const clipObjective = this.computeActorObjective(
      states,
      actions,
      oldProbs,
      advantages
    );
    const valueLoss = this.computeCriticLoss(states, returns);
    // compute an entropy bonus to encourage exploration
    const probLayers = this.actor.tensorForward(states);
    const entropy = this.getEntropy(probLayers).asScalar();
    const entropyBonus = tf.mul(this.entropyCoefficient, entropy);
    const partialObjective = tf.add(clipObjective, tf.neg(valueLoss));
    const totalObjective = tf.add(partialObjective, entropyBonus);
    console.log(
      `\nclipObjective: ${clipObjective.dataSync()}` +
        `\nvalueLoss: ${valueLoss.dataSync()}` +
        `\nentropy: ${entropy.dataSync()}\n`
    );
    // we want to minimize a "loss", so we'll just take the negative of the
    // total objective we're trying to maximize...
    const loss = tf.neg(totalObjective);
    return loss.asScalar();
  }

  train() {
    console.log(
      "=============================\n" +
        "=============================\n" +
        "=============================\n" +
        "===== UPDATING NETWORKS =====\n" +
        "=============================\n" +
        "=============================\n" +
        "=============================\n"
    );
    tf.tidy(() => {
      for (let i = 0; i < this.numEpochs; i++) {
        // create shuffled copies of the data
        this.buffer.shuffle();
        // prepare data for training by creating mini-batches
        this.buffer.createMiniBatches();
        const [
          stateTensors,
          actionTensors,
          probTensors,
          advantageTensors,
          returnTensors,
        ] = this.buffer.getMiniBatches();
        // train the actor/critic parameters via gradients with respect to
        // actor/critic "losses"
        for (let j = 0; j < stateTensors.length; j++) {
          // grab this batch
          const stateTensor = stateTensors[j];
          const actionTensor = actionTensors[j];
          const probTensor = probTensors[j];
          const advantageTensor = advantageTensors[j];
          const returnTensor = returnTensors[j];
          this.optimizer.minimize(
            () =>
              this.computeTotalLoss(
                stateTensor,
                actionTensor,
                probTensor,
                returnTensor,
                advantageTensor
              ),
            true,
            this.trainables
          );
        }
      }
      this.buffer.reset();
    });
  }

  dispose() {
    this.actor.dispose();
    this.critic.dispose();
    this.optimizer.dispose();
  }
}
