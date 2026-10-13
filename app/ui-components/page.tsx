import Header from "@/components/Header/Header";
import { fetchNavConfig } from "@/lib/nav/fetchNavConfig";
import AlertsSection from "./AlertsSection";

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
