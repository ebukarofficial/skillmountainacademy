// Registers every learning-platform route (each module calls route() when imported).
import "./routes/auth";
import "./routes/users";
import "./routes/teaching";
import "./routes/coursework";
import "./routes/admin";
import "./routes/assistant";
import "./routes/admissions";
import "./routes/admit";
export { handleLms } from "./api";
