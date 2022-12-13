import { BOARD_WIDTH, State } from "./defines";
import { paint } from "./paint";

const MOVE_SPPED = 0.02;
export class Env {
  state: State = {
    goldX: 0.2,
    goldY: 0.2,
    bombX: 0.8,
    bombY: 0,
    agentX: 0.5,
  };
  goldNum = 0;
  bombNum = 0;

  title = "";

  constructor() {
    this.reset();
  }

  takeAction(act: number) {
    const { agentX } = this.state;
    let isGameOver = false;
    let reward = 1;
    switch (act) {
      // left
      case 0:
        if (agentX < MOVE_SPPED) {
          this.state.agentX = 0;
          reward += -0.2;
        } else {
          this.state.agentX -= MOVE_SPPED;
        }
        break;
      // stay
      case 1:
        reward += 0.2;
        break;
      // right
      case 2:
        if (agentX > 1 - MOVE_SPPED) {
          this.state.agentX = 1;
          reward += -0.2;
        } else {
          this.state.agentX += MOVE_SPPED;
        }
        break;
    }
    // drop
    this.state.goldY += MOVE_SPPED;
    this.state.bombY += MOVE_SPPED;
    if (this.state.goldY >= 1) {
      if (Math.abs(this.state.agentX - this.state.goldX) <= BOARD_WIDTH / 200) {
        reward += 5;
        this.goldNum++;
      }
      this.state.goldX = Math.random();
      this.state.goldY = Math.random() / 4;
    }
    if (this.state.bombY >= 1) {
      if (Math.abs(this.state.agentX - this.state.bombX) <= BOARD_WIDTH / 200) {
        reward = -10;
        this.bombNum++;
        isGameOver = true;
      }
      this.state.bombX = Math.random();
      this.state.bombY = Math.random() / 4;
    }
    paint(this.state, this.title);
    return { reward, isGameOver };
  }

  setTitle(title: string) {
    this.title = title;
  }

  getInputLayer() {
    const { goldX, goldY, bombX, bombY, agentX } = this.state;
    return [goldX, goldY, bombX, bombY, agentX];
  }

  reset() {
    this.state = {
      goldX: Math.random(),
      goldY: Math.random() / 4,
      bombX: Math.random(),
      bombY: Math.random() / 4,
      agentX: Math.random(),
    };
    this.goldNum = 0;
    this.bombNum = 0;
    this.title = "";
  }
}
