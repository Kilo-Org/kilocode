declare const React: {
  useState: <T>(initial: T) => [T, (next: T) => void]
}

function Counter(): JSX.Element {
  const [count, setCount] = React.useState<number>(0)

  function handleClick() {}

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={handleClick}>Increment</button>
    </div>
  )
}

export default Counter
