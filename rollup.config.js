import resolve from "@rollup/plugin-node-resolve";
import babel from "@rollup/plugin-babel";
import commonjs from "rollup-plugin-commonjs";
import typescript from "rollup-plugin-typescript";

export default {
  input: "src/index.ts", // 打包入口
  output: {
    // 打包出口
    file: "dist/index.js",
    // umd: 兼容amd/cjs/iife的通用打包格式，适合浏览器
    // esm：ES6 Module
    // cjs nodejs标准
    format: "umd",
    name: "ezppo", // umd必须声明一个名字，相当于全局变量
    sourcemap: true,
  },
  plugins: [
    // 打包插件
    commonjs({
      namedExports: {
        "node_modules/@tensorflow/tfjs-core/node_modules/seedrandom/index.js": [
          "alea",
        ],
        "node_modules/seedrandom/index.js": ["alea"],
        "node_modules/@tensorflow/tfjs-backend-cpu/node_modules/seedrandom/index.js":
          ["alea"],
      },
    }), // 将 CommonJS 转换成 ES2015 模块供 Rollup 处理
    resolve(), // 查找和打包node_modules中的第三方模块
    typescript(), // 解析TypeScript
    babel({ babelHelpers: "bundled" }), // babel配置,编译es6
  ],
};
