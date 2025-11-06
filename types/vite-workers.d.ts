declare module '*?worker&module' {
  const WorkerConstructor: { new (): Worker };
  export default WorkerConstructor;
}
