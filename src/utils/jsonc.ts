export function stripJsonComments(input: string): string {
  let output = "";
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < input.length; i++) {
    const current = input[i];
    const next = input[i + 1];

    if (inString) {
      output += current;

      if (isEscaped) {
        isEscaped = false;
      } else if (current === "\\") {
        isEscaped = true;
      } else if (current === "\"") {
        inString = false;
      }

      continue;
    }

    if (current === "\"") {
      inString = true;
      output += current;
      continue;
    }

    if (current === "/" && next === "/") {
      i += 2;
      while (i < input.length && input[i] !== "\n") {
        i++;
      }
      if (i < input.length) {
        output += input[i];
      }
      continue;
    }

    if (current === "/" && next === "*") {
      i += 2;
      while (i < input.length - 1) {
        if (input[i] === "*" && input[i + 1] === "/") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    output += current;
  }

  return output;
}

export function parseJsoncObject(raw: string): unknown {
  return JSON.parse(stripJsonComments(raw));
}
