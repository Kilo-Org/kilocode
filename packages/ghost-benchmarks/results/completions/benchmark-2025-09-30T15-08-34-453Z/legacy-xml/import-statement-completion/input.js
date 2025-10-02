import ␣

function MyComponent() {
    const [count, setCount] = useState(0);

    useEffect(() => {
        console.log('Component mounted');
    }, []);

    return <div>Count: {count}</div>;
}

export default MyComponent;