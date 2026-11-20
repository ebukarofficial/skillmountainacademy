// Registers every learning-platform route (each module calls route() when imported).
import "./routes/auth";
import "./routes/users";
import "./routes/teaching";
import "./routes/coursework";
import "./routes/admin";
export { handleLms } from "./api";
