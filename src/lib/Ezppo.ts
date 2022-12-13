import Agent, { Weights } from "./agent";

interface EzppoParams {
  stateDim: number; // dimensionality of state on each step (feature vector)
  actionDim: number; // amount of discrete actions we can choose from on each step
  batchSize: number; // how many steps per batch (minimum)
  customWeights?: Weights;
  trainingMode?: boolean;
  networkLayerSet?: number[]; // network layer set like [64, 64]
  // TODO epsilon, gamma...
}

export class Ezppo {
  stateDim!: number;
  actionDim!: number;
  batchSize!: number;
  trainingMode!: boolean;
  agent: Agent;
  episodeRewards: number[] = [];
  episodeValues: number[] = [];
  lastAction: number = 0;
  lastEnvInputs: number[] = [];
  stepIndex: number = 0;
  lastProbs!: Float32Array | Int32Array | Uint8Array;

  constructor({
    stateDim,
    actionDim,
    batchSize,
    customWeights = [],
    trainingMode = true,
    networkLayerSet,
  }: EzppoParams) {
    Object.assign(this, {
      stateDim,
      actionDim,
      batchSize,
      trainingMode,
    });
    this.agent = new Agent({
      customWeights,
      stateDim,
      actionDim,
      networkLayerSet,
    });
  }

  markStepBegin() {
    this.stepIndex++;
  }

  /**
   * 返回Agent建议的actionIndex
   * @param envInputs  环境输入
   * @returns actionIndex
   */
  getStepAction(envInputs: number[]) {
    const probabilities = this.agent.actor.arrayForward(envInputs);
    const action = this.trainingMode
      ? this.agent.sampleAction(probabilities)
      : this.agent.mostLikelyAction(probabilities);
    this.lastAction = action;
    this.lastEnvInputs = envInputs;
    this.lastProbs = probabilities;
    return action;
  }

  // 标记当前step收获了多少reward
  giveStepReward(reward: number) {
    if (!this.trainingMode) {
      return;
    }
    const oneHotActionVector = new Array(this.actionDim).fill(0);
    const probabilities = this.lastProbs;
    const action = this.lastAction;
    const envInputs = this.lastEnvInputs;
    this.episodeRewards.push(reward);
    oneHotActionVector[action] = 1;
    const currentStateValue = this.agent.critic.arrayForward(envInputs)[0];
    this.episodeValues.push(currentStateValue);
    const currentActionProbability = probabilities[action];
    this.agent.buffer.store(
      [...envInputs],
      currentStateValue,
      oneHotActionVector,
      currentActionProbability
    );
  }

  /**
   * step结束时，主动调用此方法
   * @returns 如果触发了训练，返回true
   */
  epochFinished() {
    if (!this.trainingMode) {
      return false;
    }
    // TODO shift是否有必要？
    this.episodeRewards.shift();
    this.episodeRewards.push(0);

    this.agent.buffer.storeRewards(this.episodeRewards);
    const [returns, advantages] = this.agent.computeAdvantageEstimates(
      this.episodeRewards,
      this.episodeValues
    );
    this.agent.buffer.storeReturnData(returns, advantages);
    this.episodeRewards = [];
    this.episodeValues = [];
    let trained = false;
    if (this.stepIndex >= this.batchSize) {
      this.agent.train();
      this.stepIndex = 0;
      trained = true;
    }
    return trained;
  }

  // 获取当前Weights，可以保存
  getWeights() {
    this.agent.actor.saveWeights();
    this.agent.critic.saveWeights();
    const fullWeights: Weights = [];
    fullWeights.push(this.agent.actor.weightData);
    fullWeights.push(this.agent.critic.weightData);
    return fullWeights;
  }
}
