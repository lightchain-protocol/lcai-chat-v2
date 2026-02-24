import Header from "@/components/Header/Header";
import AlertsSection from "./AlertsSection";
import { fetchNavConfig } from "@/lib/nav/fetchNavConfig";

const Page = async () => {
  const rawMenus = await fetchNavConfig();
  return (
    <div>
      <Header rawMenus={rawMenus} />
      <AlertsSection />
    </div>
  );
};

export default Page;