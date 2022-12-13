import fs from "fs";
import path from "path";
import { Ezppo } from "../../src/";
import { Env } from "./env";

type Weights = number[][][];

const pathFileWeights = path.resolve(__dirname, "weights.json");

export class Game {
  env: Env;
  ezppo: Ezppo;

  stepIndex = 0;
  epochIndex = 0;

  constructor() {
    this.env = new Env();
    this.ezppo = new Ezppo({
      customWeights: this.loadWeights(),
      stateDim: 5,
      actionDim: 3,
      batchSize: 4096,
      networkLayerSet: [64, 32],
    });
  }

  run() {
    setInterval(() => {
      this.step();
    }, 0);
  }

  step() {
    const { ezppo, env } = this;
    this.stepIndex++;
    this.renderTitle();

    ezppo.markStepBegin();
    const action = ezppo.getStepAction(env.getInputLayer());
    const { reward, isGameOver } = env.takeAction(action);
    ezppo.giveStepReward(reward);

    this.checkGameOver(isGameOver);
  }

  renderTitle() {
    this.env.setTitle(
      `step: ${this.stepIndex}, epoch: ${this.epochIndex}, gold: ${this.env.goldNum}, bomb: ${this.env.bombNum}`
    );
  }

  checkGameOver(isGameOver: boolean) {
    const { ezppo, env } = this;
    if (this.stepIndex >= 1024 || isGameOver) {
      this.epochIndex++;
      this.stepIndex = 0;
      env.reset();
      const trained = ezppo.epochFinished();
      if (trained) {
        this.saveWeights();
      }
    }
  }

  saveWeights() {
    const fullWeights = this.ezppo.getWeights();
    fs.writeFileSync(pathFileWeights, JSON.stringify(fullWeights));
  }

  loadWeights(): Weights {
    if (fs.existsSync(pathFileWeights)) {
      const c = fs.readFileSync(pathFileWeights, "utf8");
      return JSON.parse(c);
    } else {
      return [];
    }
  }
}
