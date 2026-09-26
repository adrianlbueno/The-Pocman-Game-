const Illustration = () => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
      {/* Background */}
      <rect x={0} y={0} width="100%" height="100%" fill="#f2f2f2" />

      {/* Main Shape */}
      <ellipse cx="50%" cy="50%" rx="150" ry="150" fill="#3498db" />
      <path
        d="M 200,150 L 250,100 L 300,150 Z"
        stroke="#3498db"
        stroke-width="2"
      />

      {/* Circle */}
      <circle cx="225" cy="175" r="50" fill="#f1c40f" />

      {/* Text */}
      <text x="15%" y="85%" textAnchor="middle" fill="#333">
        Hello World!
      </text>
    </svg>
  );
};

export default Illustration;
